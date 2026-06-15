import { send, body, saveDb } from "../lib/helpers.js";
import {
  SYNC_OPERATION_TYPES,
  SYNC_STATUS,
  CONFLICT_STRATEGY,
  ensureSyncCollections,
  getSyncOperationById,
  listSyncOperations,
  recordSyncOperation,
  detectConflict,
  applyMergeStrategy,
  applyOperation,
  mergeExistingRecord,
  validateOperation,
  buildBatchResponse,
  listCageAbnormalReports
} from "../lib/syncData.js";
import { checkRoomWriteAccess, validateRoomAccess } from "../lib/permissions.js";
import { getAnimal } from "../lib/animalData.js";
import { getCage } from "../lib/cageData.js";

export async function handleSyncRoutes(req, res, url, db) {
  if (handleMeta(req, res, url, db)) return true;
  if (handleBatchSync(req, res, url, db)) return true;
  if (handleOperations(req, res, url, db)) return true;
  if (handleCageAbnormal(req, res, url, db)) return true;
  return false;
}

function handleMeta(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/sync/meta") {
    send(res, 200, {
      operationTypes: SYNC_OPERATION_TYPES,
      statuses: SYNC_STATUS,
      conflictStrategies: CONFLICT_STRATEGY,
      batchSizeLimit: 100,
      description: "离线巡检同步接口，支持饲养记录、体重、移笼、笼位异常、饲喂打卡的批量幂等同步"
    });
    return true;
  }
  return false;
}

function handleBatchSync(req, res, url, db) {
  if (req.method === "POST" && url.pathname === "/sync/batch") {
    handleBatchSyncPost(req, res, db);
    return true;
  }
  return false;
}

function handleOperations(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/sync/operations") {
    const filters = {
      status: url.searchParams.get("status") || undefined,
      keeper: url.searchParams.get("keeper") || undefined,
      operationType: url.searchParams.get("operationType") || undefined,
      fromDate: url.searchParams.get("fromDate") || undefined,
      toDate: url.searchParams.get("toDate") || undefined
    };
    send(res, 200, listSyncOperations(db, filters));
    return true;
  }

  const opMatch = url.pathname.match(/^\/sync\/operations\/([^/]+)$/);
  if (opMatch && req.method === "GET") {
    const op = getSyncOperationById(db, opMatch[1]);
    if (!op) {
      send(res, 404, { error: "sync_operation_not_found" });
      return true;
    }
    send(res, 200, op);
    return true;
  }

  return false;
}

function handleCageAbnormal(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/sync/cage-abnormal") {
    const filters = {
      cageId: url.searchParams.get("cageId") || undefined,
      roomId: url.searchParams.get("roomId") || undefined,
      status: url.searchParams.get("status") || undefined,
      severity: url.searchParams.get("severity") || undefined,
      fromDate: url.searchParams.get("fromDate") || undefined,
      toDate: url.searchParams.get("toDate") || undefined
    };
    send(res, 200, listCageAbnormalReports(db, filters));
    return true;
  }
  return false;
}

async function handleBatchSyncPost(req, res, db) {
  const input = await body(req);

  if (!Array.isArray(input.operations)) {
    return send(res, 400, {
      error: "invalid_input",
      message: "请求体必须包含 operations 数组",
      expectedFormat: {
        operations: [
          {
            operationId: "uuid-client-generated",
            operationType: "animal_note|animal_move|feeding_record|cage_abnormal",
            keeper: "饲养员姓名",
            deviceId: "可选，移动端设备标识",
            clientCreatedAt: "2026-06-15T08:30:00.000Z",
            conflictStrategy: "可选，merge_non_conflict|server_wins|client_wins|reject，默认 merge_non_conflict",
            payload: {}
          }
        ]
      }
    });
  }

  if (input.operations.length === 0) {
    return send(res, 400, { error: "empty_batch", message: "同步批次不能为空" });
  }

  if (input.operations.length > 100) {
    return send(res, 400, { error: "batch_too_large", message: "单次同步最多 100 条操作", limit: 100 });
  }

  ensureSyncCollections(db);

  const results = [];

  for (const operation of input.operations) {
    const result = await processSingleOperation(db, operation, req._principal);
    results.push(result);
    recordSyncOperation(db, operation, result);
  }

  await saveDb(db);

  const anyApplied = results.some((r) => r.status === SYNC_STATUS.APPLIED || r.status === SYNC_STATUS.PARTIAL);
  const hasConflicts = results.some((r) => r.status === SYNC_STATUS.CONFLICT);

  let statusCode = 200;
  if (hasConflicts && !anyApplied) statusCode = 409;
  else if (!anyApplied && results.every((r) => r.status === SYNC_STATUS.DUPLICATE)) statusCode = 200;
  else if (results.every((r) => r.status === SYNC_STATUS.ERROR)) statusCode = 422;

  send(res, statusCode, buildBatchResponse(results));
}

async function processSingleOperation(db, operation, principal) {
  const validation = validateOperation(operation);
  if (!validation.valid) {
    return {
      operation,
      status: SYNC_STATUS.ERROR,
      error: { code: "validation_failed", details: validation.errors }
    };
  }

  const existing = getSyncOperationById(db, operation.operationId);
  if (existing) {
    return {
      operation,
      status: SYNC_STATUS.DUPLICATE,
      data: existing.result,
      error: null,
      duplicateOf: {
        operationId: existing.operationId,
        submittedAt: existing.submittedAt,
        status: existing.status
      }
    };
  }

  const accessCheck = await checkOperationAccess(db, operation, principal);
  if (!accessCheck.authorized) {
    return {
      operation,
      status: SYNC_STATUS.ERROR,
      error: { code: accessCheck.error, message: accessCheck.message }
    };
  }

  const strategy = operation.conflictStrategy || CONFLICT_STRATEGY.MERGE_NON_CONFLICT;
  const conflictInfo = detectConflict(db, operation);

  if (conflictInfo.hasConflict) {
    const hasConflictingFields = (conflictInfo.conflictDetails?.conflictingFields?.length || 0) > 0;

    if (!hasConflictingFields) {
      const existingRecord = conflictInfo.existingOperation;
      return {
        operation,
        status: SYNC_STATUS.DUPLICATE,
        data: existingRecord?.result || null,
        conflictDetails: conflictInfo.conflictDetails,
        duplicateOf: {
          operationId: existingRecord?.operationId,
          submittedAt: existingRecord?.submittedAt,
          status: existingRecord?.status,
          note: "相同提交（所有字段值一致），视为重复，采用服务端已有数据"
        }
      };
    }

    if (strategy === CONFLICT_STRATEGY.REJECT) {
      return {
        operation,
        status: SYNC_STATUS.CONFLICT,
        conflictDetails: conflictInfo.conflictDetails,
        error: { code: "conflict_rejected", message: "存在冲突，按策略拒绝写入" }
      };
    }

    const mergeResult = applyMergeStrategy(db, operation, conflictInfo, strategy);
    if (mergeResult.merged && mergeResult.fields.length > 0) {
      const effectivePayload = buildEffectivePayload(operation.payload, conflictInfo.conflictDetails, strategy);
      const merged = await mergeExistingRecord(db, conflictInfo.existingOperation, effectivePayload, strategy, { operator: principal });

      if (!merged.ok) {
        return {
          operation,
          status: SYNC_STATUS.ERROR,
          error: { code: merged.error, message: merged.message }
        };
      }

      return {
        operation,
        status: SYNC_STATUS.PARTIAL,
        data: merged.data,
        conflictDetails: conflictInfo.conflictDetails,
        mergedFields: mergeResult.fields,
        mergeStrategy: strategy,
        partialMergeNote: mergeResult.partialMerge ? `仍有 ${conflictInfo.conflictDetails.conflictingFields.length} 个冲突字段未合并，需人工处理` : null
      };
    }

    if (strategy === CONFLICT_STRATEGY.SERVER_WINS && mergeResult.fields.length === 0) {
      return {
        operation,
        status: SYNC_STATUS.CONFLICT,
        conflictDetails: conflictInfo.conflictDetails,
        error: { code: "server_wins_no_mergeable", message: "按服务端优先策略，无新字段可合并，全部采用服务端数据" }
      };
    }

    return {
      operation,
      status: SYNC_STATUS.CONFLICT,
      conflictDetails: conflictInfo.conflictDetails,
      error: { code: "conflict_detected", message: conflictInfo.conflictDetails.explanation }
    };
  }

  const applied = await applyOperation(db, operation, { operator: principal });
  if (!applied.ok) {
    return {
      operation,
      status: SYNC_STATUS.ERROR,
      error: { code: applied.error, message: applied.message }
    };
  }

  return {
    operation,
    status: SYNC_STATUS.APPLIED,
    data: applied.data
  };
}

async function checkOperationAccess(db, operation, principal) {
  if (!principal) {
    return { authorized: false, error: "unauthenticated", message: "未认证用户" };
  }

  const opType = operation.operationType;
  const payload = operation.payload || {};

  let targetRoomId = null;

  if (opType === SYNC_OPERATION_TYPES.ANIMAL_NOTE || opType === SYNC_OPERATION_TYPES.ANIMAL_MOVE) {
    const animal = getAnimal(db, payload.animalId);
    if (animal) targetRoomId = animal.roomId;
  } else if (opType === SYNC_OPERATION_TYPES.FEEDING_RECORD) {
    if (payload.targetType === "animal") {
      const animal = getAnimal(db, payload.targetId);
      if (animal) targetRoomId = animal.roomId;
    } else if (payload.targetType === "cage") {
      const cage = getCage(db, payload.targetId);
      if (cage) targetRoomId = cage.roomId;
    }
  } else if (opType === SYNC_OPERATION_TYPES.CAGE_ABNORMAL) {
    const cage = getCage(db, payload.cageId);
    if (cage) targetRoomId = cage.roomId;
  }

  if (targetRoomId) {
    return checkRoomWriteAccess(principal, targetRoomId);
  }

  return { authorized: true };
}

function buildEffectivePayload(originalPayload, conflictDetails, strategy) {
  if (strategy === CONFLICT_STRATEGY.CLIENT_WINS) {
    return { ...originalPayload };
  }

  const effective = {};

  for (const field of conflictDetails.nonConflictingFields) {
    if (field.identical) {
      effective[field.field] = field.clientValue ?? field.serverValue;
    } else if (field.clientValue != null && field.clientValue !== "") {
      effective[field.field] = field.clientValue;
    } else if (field.serverValue != null && field.serverValue !== "") {
      effective[field.field] = field.serverValue;
    }
  }

  for (const key of Object.keys(originalPayload)) {
    if (!(key in effective)) {
      const isConflict = conflictDetails.conflictingFields.some((f) => f.field === key);
      if (!isConflict) {
        effective[key] = originalPayload[key];
      }
    }
  }

  return effective;
}
