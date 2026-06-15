import { localDate } from "./helpers.js";
import { addNote, moveAnimal, getAnimal } from "./animalData.js";
import { addFeedingRecord, ensureFeedingCollections } from "./feedingData.js";
import { detectAndCreateEvent } from "./healthEventData.js";
import { getCage } from "./cageData.js";

export const SYNC_OPERATION_TYPES = {
  ANIMAL_NOTE: "animal_note",
  ANIMAL_MOVE: "animal_move",
  FEEDING_RECORD: "feeding_record",
  CAGE_ABNORMAL: "cage_abnormal"
};

export const SYNC_STATUS = {
  PENDING: "pending",
  APPLIED: "applied",
  DUPLICATE: "duplicate",
  CONFLICT: "conflict",
  ERROR: "error",
  PARTIAL: "partial"
};

export const CONFLICT_STRATEGY = {
  SERVER_WINS: "server_wins",
  CLIENT_WINS: "client_wins",
  MERGE_NON_CONFLICT: "merge_non_conflict",
  REJECT: "reject"
};

export function ensureSyncCollections(db) {
  if (!db.syncOperations) db.syncOperations = [];
  if (!db.syncQueues) db.syncQueues = [];
  if (!db.cageAbnormalReports) db.cageAbnormalReports = [];
}

export function getSyncOperationById(db, operationId) {
  ensureSyncCollections(db);
  return db.syncOperations.find((op) => op.operationId === operationId) || null;
}

export function listSyncOperations(db, filters = {}) {
  ensureSyncCollections(db);
  let ops = [...db.syncOperations];
  if (filters.status) ops = ops.filter((o) => o.status === filters.status);
  if (filters.keeper) ops = ops.filter((o) => o.keeper === filters.keeper);
  if (filters.operationType) ops = ops.filter((o) => o.operationType === filters.operationType);
  if (filters.fromDate) ops = ops.filter((o) => o.submittedAt >= filters.fromDate);
  if (filters.toDate) ops = ops.filter((o) => o.submittedAt <= filters.toDate);
  return ops.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export function recordSyncOperation(db, operation, result) {
  ensureSyncCollections(db);
  const record = {
    operationId: operation.operationId,
    operationType: operation.operationType,
    keeper: operation.keeper,
    deviceId: operation.deviceId || null,
    clientCreatedAt: operation.clientCreatedAt || null,
    submittedAt: new Date().toISOString(),
    status: result.status,
    payload: operation.payload,
    result: result.data || null,
    conflictDetails: result.conflictDetails || null,
    error: result.error || null,
    mergedFields: result.mergedFields || null,
    animalId: resolveAnimalId(operation) || null,
    cageId: resolveCageId(operation) || null,
    date: resolveOperationDate(operation)
  };
  db.syncOperations.push(record);
  return record;
}

function resolveAnimalId(operation) {
  const p = operation.payload || {};
  switch (operation.operationType) {
    case SYNC_OPERATION_TYPES.ANIMAL_NOTE:
    case SYNC_OPERATION_TYPES.ANIMAL_MOVE:
      return p.animalId || null;
    case SYNC_OPERATION_TYPES.FEEDING_RECORD:
      return p.targetType === "animal" ? p.targetId : null;
    default:
      return null;
  }
}

function resolveCageId(operation) {
  const p = operation.payload || {};
  switch (operation.operationType) {
    case SYNC_OPERATION_TYPES.ANIMAL_MOVE:
      return p.cageId || null;
    case SYNC_OPERATION_TYPES.FEEDING_RECORD:
      return p.targetType === "cage" ? p.targetId : null;
    case SYNC_OPERATION_TYPES.CAGE_ABNORMAL:
      return p.cageId || null;
    default:
      return null;
  }
}

function resolveOperationDate(operation) {
  const p = operation.payload || {};
  return p.date || (operation.clientCreatedAt || "").slice(0, 10) || localDate();
}

export function detectConflict(db, operation) {
  const animalId = resolveAnimalId(operation);
  const cageId = resolveCageId(operation);
  const opDate = resolveOperationDate(operation);
  const opType = operation.operationType;

  ensureSyncCollections(db);

  const conflicting = db.syncOperations.filter((existing) => {
    if (existing.operationId === operation.operationId) return false;
    if (existing.status === SYNC_STATUS.ERROR) return false;
    if (existing.operationType !== opType) return false;

    const existingDate = existing.date || (existing.submittedAt || "").slice(0, 10);
    if (existingDate !== opDate) return false;

    if (animalId && existing.animalId && existing.animalId === animalId) return true;
    if (cageId && existing.cageId && existing.cageId === cageId && opType === SYNC_OPERATION_TYPES.CAGE_ABNORMAL) return true;

    return false;
  });

  if (conflicting.length === 0) return { hasConflict: false };

  const existingOp = conflicting[0];
  const conflictDetails = buildConflictDetails(operation, existingOp);

  return {
    hasConflict: true,
    existingOperation: existingOp,
    conflictDetails
  };
}

function buildConflictDetails(incoming, existing) {
  const inPayload = incoming.payload || {};
  const exPayload = existing.payload || {};
  const conflicts = [];
  const nonConflicts = [];

  const allKeys = new Set([...Object.keys(inPayload), ...Object.keys(exPayload)]);

  for (const key of allKeys) {
    const inVal = inPayload[key];
    const exVal = exPayload[key];
    if (inVal === undefined || inVal === null || inVal === "") {
      if (exVal !== undefined && exVal !== null && exVal !== "") {
        nonConflicts.push({ field: key, clientValue: null, serverValue: exVal });
      }
      continue;
    }
    if (exVal === undefined || exVal === null || exVal === "") {
      nonConflicts.push({ field: key, clientValue: inVal, serverValue: null });
      continue;
    }
    if (JSON.stringify(inVal) === JSON.stringify(exVal)) {
      nonConflicts.push({ field: key, clientValue: inVal, serverValue: exVal, identical: true });
    } else {
      conflicts.push({ field: key, clientValue: inVal, serverValue: exVal });
    }
  }

  return {
    incomingOperationId: incoming.operationId,
    existingOperationId: existing.operationId,
    existingKeeper: existing.keeper,
    existingSubmittedAt: existing.submittedAt,
    existingClientCreatedAt: existing.clientCreatedAt,
    operationType: incoming.operationType,
    date: incoming.payload?.date || (incoming.clientCreatedAt || "").slice(0, 10),
    animalId: resolveAnimalId(incoming),
    cageId: resolveCageId(incoming),
    conflictingFields: conflicts,
    nonConflictingFields: nonConflicts,
    explanation: buildConflictExplanation(conflicts, nonConflicts, incoming.operationType)
  };
}

function buildConflictExplanation(conflicts, nonConflicts, opType) {
  const typeNames = {
    [SYNC_OPERATION_TYPES.ANIMAL_NOTE]: "饲养记录/体重",
    [SYNC_OPERATION_TYPES.ANIMAL_MOVE]: "动物移笼",
    [SYNC_OPERATION_TYPES.FEEDING_RECORD]: "饲喂打卡",
    [SYNC_OPERATION_TYPES.CAGE_ABNORMAL]: "笼位异常上报"
  };
  const typeName = typeNames[opType] || opType;
  const parts = [];
  parts.push(`同一${typeName}在当天已有服务端记录，存在 ${conflicts.length} 个字段冲突`);
  if (conflicts.length > 0) {
    const fieldNames = conflicts.map((c) => c.field).join("、");
    parts.push(`冲突字段：${fieldNames}`);
  }
  if (nonConflicts.length > 0) {
    const canMerge = nonConflicts.filter((f) => !f.identical).length;
    if (canMerge > 0) {
      parts.push(`${canMerge} 个非冲突字段可自动合并`);
    }
  }
  return parts.join("；");
}

export function applyMergeStrategy(db, operation, conflictInfo, strategy) {
  const details = conflictInfo.conflictDetails;
  if (!details) return { merged: false, fields: [], strategy };

  if (strategy === CONFLICT_STRATEGY.REJECT) {
    return { merged: false, fields: [], strategy, reason: "reject_strategy" };
  }

  if (strategy === CONFLICT_STRATEGY.SERVER_WINS) {
    return {
      merged: true,
      fields: details.nonConflictingFields.filter((f) => f.clientValue && !f.serverValue).map((f) => f.field),
      strategy,
      skippedConflictFields: details.conflictingFields.map((f) => f.field)
    };
  }

  if (strategy === CONFLICT_STRATEGY.CLIENT_WINS) {
    return {
      merged: true,
      fields: [...details.conflictingFields.map((f) => f.field), ...details.nonConflictingFields.map((f) => f.field)],
      strategy,
      overwroteServerFields: details.conflictingFields.map((f) => f.field)
    };
  }

  if (strategy === CONFLICT_STRATEGY.MERGE_NON_CONFLICT) {
    const merged = details.nonConflictingFields.filter((f) => !f.identical);
    return {
      merged: merged.length > 0,
      fields: merged.map((f) => f.field),
      strategy,
      remainingConflictFields: details.conflictingFields.map((f) => f.field),
      partialMerge: details.conflictingFields.length > 0
    };
  }

  return { merged: false, fields: [], strategy };
}

export async function mergeExistingRecord(db, existingOperation, effectivePayload, strategy, options = {}) {
  const opType = existingOperation.operationType;
  const operator = options.operator || null;

  switch (opType) {
    case SYNC_OPERATION_TYPES.ANIMAL_NOTE:
      return await mergeExistingNote(db, existingOperation, effectivePayload, strategy, operator);
    case SYNC_OPERATION_TYPES.ANIMAL_MOVE:
      return await mergeExistingMove(db, existingOperation, effectivePayload, strategy, operator);
    case SYNC_OPERATION_TYPES.FEEDING_RECORD:
      return await mergeExistingFeedingRecord(db, existingOperation, effectivePayload, strategy, operator);
    case SYNC_OPERATION_TYPES.CAGE_ABNORMAL:
      return await mergeExistingCageReport(db, existingOperation, effectivePayload, strategy, operator);
    default:
      return { ok: false, error: "unknown_operation_type", message: `未知操作类型: ${opType}` };
  }
}

async function mergeExistingNote(db, existingOp, effectivePayload, strategy, operator) {
  const noteId = existingOp.result?.note?.id;
  const animalId = existingOp.animalId || existingOp.payload?.animalId;
  if (!noteId || !animalId) {
    return { ok: false, error: "original_record_not_found", message: "无法定位原始饲养记录" };
  }

  const animal = getAnimal(db, animalId);
  if (!animal) return { ok: false, error: "animal_not_found", message: `动物 ${animalId} 不存在` };

  const noteIdx = animal.notes.findIndex((n) => n.id === noteId);
  if (noteIdx === -1) return { ok: false, error: "note_not_found", message: `原始记录 ${noteId} 不存在` };

  const note = animal.notes[noteIdx];
  const updatable = ["weight", "condition", "keeper", "type"];
  for (const field of updatable) {
    if (effectivePayload[field] !== undefined) {
      note[field] = effectivePayload[field];
    }
  }
  if (Array.isArray(effectivePayload.photoPlaceholders)) {
    note.photoPlaceholders = effectivePayload.photoPlaceholders;
  }
  note.lastMergedAt = new Date().toISOString();
  note.mergeStrategy = strategy;

  let healthResult = null;
  const condition = note.condition || "";
  const weight = note.weight;
  if (condition || weight != null) {
    healthResult = await detectAndCreateEvent(db, {
      animalId,
      condition,
      weight,
      source: "animal_note_merge",
      sourceRecordId: noteId,
      keeper: note.keeper
    });
  }

  return {
    ok: true,
    data: {
      note: { ...note },
      healthEvent: healthResult
        ? {
            created: healthResult.created,
            merged: healthResult.merged || false,
            eventId: healthResult.event ? healthResult.event.id : null
          }
        : null
    }
  };
}

async function mergeExistingMove(db, existingOp, effectivePayload, strategy, operator) {
  if (strategy === CONFLICT_STRATEGY.CLIENT_WINS && effectivePayload.cageId) {
    const animalId = existingOp.animalId || effectivePayload.animalId;
    const animal = getAnimal(db, animalId);
    if (!animal) return { ok: false, error: "animal_not_found", message: `动物 ${animalId} 不存在` };

    const targetCage = getCage(db, effectivePayload.cageId);
    if (!targetCage) return { ok: false, error: "cage_not_found", message: `目标笼位 ${effectivePayload.cageId} 不存在` };

    const updated = await moveAnimal(db, animalId, effectivePayload.cageId, effectivePayload.reason || "离线同步冲突合并-客户端优先移笼", {
      operator,
      skipEvent: false,
      metadata: { syncMerge: true, strategy, offline: true }
    });

    return { ok: true, data: { animal: updated, move: updated.moves[updated.moves.length - 1] } };
  }

  const animalId = existingOp.animalId || effectivePayload.animalId;
  const animal = getAnimal(db, animalId);
  if (!animal) return { ok: false, error: "animal_not_found", message: `动物 ${animalId} 不存在` };

  const existingMove = existingOp.result?.move;
  return { ok: true, data: { animal, move: existingMove } };
}

async function mergeExistingFeedingRecord(db, existingOp, effectivePayload, strategy, operator) {
  const recordId = existingOp.result?.record?.id;
  if (!recordId) {
    return { ok: false, error: "original_record_not_found", message: "无法定位原始饲喂记录" };
  }

  ensureFeedingCollections(db);
  const record = db.feedingRecords.find((r) => r.id === recordId);
  if (!record) return { ok: false, error: "record_not_found", message: `原始饲喂记录 ${recordId} 不存在` };

  const updatable = ["feedType", "amount", "condition", "weight", "keeper", "notes"];
  for (const field of updatable) {
    if (effectivePayload[field] !== undefined) {
      record[field] = effectivePayload[field];
    }
  }
  record.lastMergedAt = new Date().toISOString();
  record.mergeStrategy = strategy;

  return { ok: true, data: { record: { ...record } } };
}

async function mergeExistingCageReport(db, existingOp, effectivePayload, strategy, operator) {
  const reportId = existingOp.result?.report?.id;
  if (!reportId) {
    return { ok: false, error: "original_record_not_found", message: "无法定位原始笼位异常报告" };
  }

  ensureSyncCollections(db);
  const report = db.cageAbnormalReports.find((r) => r.id === reportId);
  if (!report) return { ok: false, error: "report_not_found", message: `原始笼位异常报告 ${reportId} 不存在` };

  const updatable = ["abnormalType", "severity", "description", "keeper", "reporter", "notes"];
  for (const field of updatable) {
    if (effectivePayload[field] !== undefined) {
      report[field] = effectivePayload[field];
    }
  }
  if (Array.isArray(effectivePayload.photoPlaceholders)) {
    report.photoPlaceholders = effectivePayload.photoPlaceholders;
  }
  report.lastMergedAt = new Date().toISOString();
  report.mergeStrategy = strategy;

  return { ok: true, data: { report: { ...report } } };
}

export async function applyOperation(db, operation, options = {}) {
  const opType = operation.operationType;
  const payload = { ...(operation.payload || {}) };
  if (operation.keeper && !payload.keeper && !payload.reporter) {
    payload.keeper = operation.keeper;
  }
  const operator = options.operator || null;

  switch (opType) {
    case SYNC_OPERATION_TYPES.ANIMAL_NOTE:
      return await applyAnimalNote(db, payload, operator);
    case SYNC_OPERATION_TYPES.ANIMAL_MOVE:
      return await applyAnimalMove(db, payload, operator);
    case SYNC_OPERATION_TYPES.FEEDING_RECORD:
      return await applyFeedingRecord(db, payload, operator);
    case SYNC_OPERATION_TYPES.CAGE_ABNORMAL:
      return await applyCageAbnormal(db, payload, operator);
    default:
      return { ok: false, error: "unknown_operation_type", message: `未知操作类型: ${opType}` };
  }
}

async function applyAnimalNote(db, payload, operator) {
  const animal = getAnimal(db, payload.animalId);
  if (!animal) {
    return { ok: false, error: "animal_not_found", message: `动物 ${payload.animalId} 不存在` };
  }

  const noteInput = {
    date: payload.date || localDate(),
    weight: payload.weight,
    condition: payload.condition,
    keeper: payload.keeper || animal.keeper,
    type: payload.type || "general",
    photoPlaceholders: payload.photoPlaceholders || []
  };

  const note = await addNote(db, payload.animalId, noteInput, {
    operator,
    skipEvent: true,
    metadata: { syncOperationId: payload.operationId, offline: true }
  });

  let healthResult = null;
  const condition = payload.condition || "";
  const weight = payload.weight;
  if (condition || weight != null) {
    healthResult = await detectAndCreateEvent(db, {
      animalId: payload.animalId,
      condition,
      weight,
      source: "animal_note_sync",
      sourceRecordId: note.id,
      keeper: noteInput.keeper
    });
  }

  return {
    ok: true,
    data: {
      note,
      healthEvent: healthResult
        ? {
            created: healthResult.created,
            merged: healthResult.merged || false,
            eventId: healthResult.event ? healthResult.event.id : null
          }
        : null
    }
  };
}

async function applyAnimalMove(db, payload, operator) {
  const animal = getAnimal(db, payload.animalId);
  if (!animal) {
    return { ok: false, error: "animal_not_found", message: `动物 ${payload.animalId} 不存在` };
  }
  const targetCage = getCage(db, payload.cageId);
  if (!targetCage) {
    return { ok: false, error: "cage_not_found", message: `目标笼位 ${payload.cageId} 不存在` };
  }

  const updated = await moveAnimal(db, payload.animalId, payload.cageId, payload.reason || "离线同步移笼", {
    operator,
    skipEvent: false,
    metadata: { syncOperationId: payload.operationId, offline: true }
  });

  return { ok: true, data: { animal: updated, move: updated.moves[updated.moves.length - 1] } };
}

async function applyFeedingRecord(db, payload, operator) {
  if (!payload.targetType || !payload.targetId) {
    return { ok: false, error: "missing_target", message: "饲喂记录缺少 targetType 或 targetId" };
  }
  if (payload.targetType === "animal") {
    const animal = getAnimal(db, payload.targetId);
    if (!animal) {
      return { ok: false, error: "animal_not_found", message: `动物 ${payload.targetId} 不存在` };
    }
  } else if (payload.targetType === "cage") {
    const cage = getCage(db, payload.targetId);
    if (!cage) {
      return { ok: false, error: "cage_not_found", message: `笼位 ${payload.targetId} 不存在` };
    }
  }

  const record = await addFeedingRecord(
    db,
    {
      ...payload,
      notes: payload.notes || (payload.photoPlaceholders?.length ? `[离线同步含 ${payload.photoPlaceholders.length} 张照片占位]` : "")
    },
    { operator, metadata: { syncOperationId: payload.operationId, offline: true } }
  );

  return { ok: true, data: { record } };
}

async function applyCageAbnormal(db, payload, operator) {
  if (!payload.cageId) {
    return { ok: false, error: "missing_cage_id", message: "笼位异常缺少 cageId" };
  }
  const cage = getCage(db, payload.cageId);
  if (!cage) {
    return { ok: false, error: "cage_not_found", message: `笼位 ${payload.cageId} 不存在` };
  }

  ensureSyncCollections(db);
  const report = {
    id: `car-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    cageId: payload.cageId,
    roomId: cage.roomId,
    zoneId: cage.zoneId,
    date: payload.date || localDate(),
    reportedAt: new Date().toISOString(),
    clientReportedAt: payload.clientReportedAt || payload.clientCreatedAt || null,
    reporter: payload.reporter || (operator ? operator.name : null),
    keeper: payload.keeper || (operator ? operator.name : null),
    abnormalType: payload.abnormalType || "other",
    severity: payload.severity || "normal",
    description: payload.description || "",
    photoPlaceholders: payload.photoPlaceholders || [],
    status: "open",
    notes: payload.notes || ""
  };
  db.cageAbnormalReports.push(report);

  return { ok: true, data: { report } };
}

export function validateOperation(operation) {
  const errors = [];
  if (!operation.operationId) {
    errors.push({ field: "operationId", message: "operationId 必填（客户端生成的唯一操作ID，用于幂等去重）" });
  }
  if (!operation.operationType) {
    errors.push({ field: "operationType", message: "operationType 必填" });
  } else if (!Object.values(SYNC_OPERATION_TYPES).includes(operation.operationType)) {
    errors.push({
      field: "operationType",
      message: `operationType 必须是: ${Object.values(SYNC_OPERATION_TYPES).join(", ")}`
    });
  }
  if (!operation.keeper) {
    errors.push({ field: "keeper", message: "keeper 必填" });
  }
  if (!operation.payload || typeof operation.payload !== "object") {
    errors.push({ field: "payload", message: "payload 必须是对象" });
  } else {
    validatePayloadByType(operation, errors);
  }
  return { valid: errors.length === 0, errors };
}

function validatePayloadByType(operation, errors) {
  const p = operation.payload;
  switch (operation.operationType) {
    case SYNC_OPERATION_TYPES.ANIMAL_NOTE:
      if (!p.animalId) errors.push({ field: "payload.animalId", message: "animal_note 操作需要 animalId" });
      if (p.weight != null && typeof p.weight !== "number") {
        errors.push({ field: "payload.weight", message: "weight 必须是数字" });
      }
      if (p.photoPlaceholders && !Array.isArray(p.photoPlaceholders)) {
        errors.push({ field: "payload.photoPlaceholders", message: "photoPlaceholders 必须是数组" });
      }
      break;
    case SYNC_OPERATION_TYPES.ANIMAL_MOVE:
      if (!p.animalId) errors.push({ field: "payload.animalId", message: "animal_move 操作需要 animalId" });
      if (!p.cageId) errors.push({ field: "payload.cageId", message: "animal_move 操作需要 cageId" });
      break;
    case SYNC_OPERATION_TYPES.FEEDING_RECORD:
      if (!p.targetType) errors.push({ field: "payload.targetType", message: "feeding_record 需要 targetType" });
      if (!p.targetId) errors.push({ field: "payload.targetId", message: "feeding_record 需要 targetId" });
      if (!p.feedType) errors.push({ field: "payload.feedType", message: "feeding_record 需要 feedType" });
      if (!p.keeper && !operation.keeper) errors.push({ field: "payload.keeper", message: "feeding_record 需要 keeper（可在 payload.keeper 或顶层 operation.keeper 中提供）" });
      break;
    case SYNC_OPERATION_TYPES.CAGE_ABNORMAL:
      if (!p.cageId) errors.push({ field: "payload.cageId", message: "cage_abnormal 需要 cageId" });
      break;
  }
}

export function buildBatchResponse(results) {
  const summary = {
    total: results.length,
    applied: results.filter((r) => r.status === SYNC_STATUS.APPLIED).length,
    duplicates: results.filter((r) => r.status === SYNC_STATUS.DUPLICATE).length,
    conflicts: results.filter((r) => r.status === SYNC_STATUS.CONFLICT).length,
    errors: results.filter((r) => r.status === SYNC_STATUS.ERROR).length,
    partial: results.filter((r) => r.status === SYNC_STATUS.PARTIAL).length
  };

  return {
    summary,
    results: results.map((r) => ({
      operationId: r.operation.operationId,
      operationType: r.operation.operationType,
      status: r.status,
      data: r.data || null,
      conflict: r.conflictDetails || null,
      error: r.error || null,
      mergedFields: r.mergedFields || null,
      duplicateOf: r.duplicateOf || null,
      mergeStrategy: r.mergeStrategy || null,
      partialMergeNote: r.partialMergeNote || null
    }))
  };
}

export function listCageAbnormalReports(db, filters = {}) {
  ensureSyncCollections(db);
  let reports = [...db.cageAbnormalReports];
  if (filters.cageId) reports = reports.filter((r) => r.cageId === filters.cageId);
  if (filters.roomId) reports = reports.filter((r) => r.roomId === filters.roomId);
  if (filters.status) reports = reports.filter((r) => r.status === filters.status);
  if (filters.severity) reports = reports.filter((r) => r.severity === filters.severity);
  if (filters.fromDate) reports = reports.filter((r) => r.date >= filters.fromDate);
  if (filters.toDate) reports = reports.filter((r) => r.date <= filters.toDate);
  return reports.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}
