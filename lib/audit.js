import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultAuditPath = join(__dirname, "..", "data", "audit-logs.json");
const auditPath = process.env.AUDIT_LOG_PATH || defaultAuditPath;

export const AUDIT_OPERATIONS = {
  ANIMAL_CREATE: "animal.create",
  ANIMAL_UPDATE_NOTE: "animal.add_note",
  ANIMAL_MOVE: "animal.move",
  ANIMAL_REMOVE: "animal.remove",
  ANIMAL_QUARANTINE_RECORD: "animal.quarantine_record",
  ANIMAL_QUARANTINE_RELEASE: "animal.quarantine_release",
  ANIMAL_QUARANTINE_ABNORMAL: "animal.quarantine_abnormal",
  ANIMAL_QUARANTINE_RESOLVE: "animal.quarantine_resolve",
  ANIMAL_IMPORT: "animal.batch_import",
  CAGE_CREATE: "cage.create",
  CAGE_DISABLE: "cage.disable",
  FEEDING_PLAN_CREATE: "feeding.plan_create",
  FEEDING_PLAN_DISABLE: "feeding.plan_disable",
  FEEDING_CHECKIN: "feeding.checkin",
  BREEDING_PAIR_CREATE: "breeding.pair_create",
  BREEDING_PAIR_STATUS: "breeding.pair_status",
  BREEDING_PAIR_CANCEL: "breeding.pair_cancel",
  BREEDING_LITTER_CREATE: "breeding.litter_create",
  BREEDING_LITTER_UPDATE: "breeding.litter_update",
  BREEDING_LITTER_WEAN: "breeding.litter_wean",
  HEALTH_EVENT_CREATE: "health.event_create",
  HEALTH_EVENT_ASSIGN: "health.event_assign",
  HEALTH_EVENT_NOTE: "health.event_note",
  HEALTH_EVENT_CLOSE: "health.event_close",
  HEALTH_MIGRATE: "health.migrate_historical",
  SYNC_BATCH: "sync.batch",
  SYNC_OPERATION_QUERY: "sync.operation_query"
};

const writeOperationPatterns = [
  { pattern: /^POST \/animals$/, op: AUDIT_OPERATIONS.ANIMAL_CREATE, extractAnimalId: (_m, _p, _r, res) => res?.id || null },
  { pattern: /^POST \/animals\/[^/]+\/notes$/, op: AUDIT_OPERATIONS.ANIMAL_UPDATE_NOTE, extractAnimalIdFromPath },
  { pattern: /^POST \/animals\/[^/]+\/move$/, op: AUDIT_OPERATIONS.ANIMAL_MOVE, extractAnimalIdFromPath },
  { pattern: /^POST \/animals\/[^/]+\/remove$/, op: AUDIT_OPERATIONS.ANIMAL_REMOVE, extractAnimalIdFromPath },
  { pattern: /^POST \/animals\/[^/]+\/quarantine\/record$/, op: AUDIT_OPERATIONS.ANIMAL_QUARANTINE_RECORD, extractAnimalIdFromPath },
  { pattern: /^POST \/animals\/[^/]+\/quarantine\/release$/, op: AUDIT_OPERATIONS.ANIMAL_QUARANTINE_RELEASE, extractAnimalIdFromPath },
  { pattern: /^POST \/animals\/[^/]+\/quarantine\/abnormal$/, op: AUDIT_OPERATIONS.ANIMAL_QUARANTINE_ABNORMAL, extractAnimalIdFromPath },
  { pattern: /^POST \/animals\/[^/]+\/quarantine\/resolve$/, op: AUDIT_OPERATIONS.ANIMAL_QUARANTINE_RESOLVE, extractAnimalIdFromPath },
  { pattern: /^POST \/animals\/import$/, op: AUDIT_OPERATIONS.ANIMAL_IMPORT, extractAnimalId: (_m, _p, _r, res) => res?.animals?.map((a) => a.id).filter(Boolean) || [] },
  { pattern: /^POST \/cages$/, op: AUDIT_OPERATIONS.CAGE_CREATE, extractAnimalId: () => null },
  { pattern: /^POST \/cages\/[^/]+\/disable$/, op: AUDIT_OPERATIONS.CAGE_DISABLE, extractAnimalId: () => null },
  { pattern: /^POST \/feeding\/plans$/, op: AUDIT_OPERATIONS.FEEDING_PLAN_CREATE, extractAnimalId: () => null },
  { pattern: /^POST \/feeding\/plans\/[^/]+\/disable$/, op: AUDIT_OPERATIONS.FEEDING_PLAN_DISABLE, extractAnimalId: () => null },
  { pattern: /^POST \/feeding\/checkin$/, op: AUDIT_OPERATIONS.FEEDING_CHECKIN, extractAnimalIdFromTarget },
  { pattern: /^POST \/breeding\/pairs$/, op: AUDIT_OPERATIONS.BREEDING_PAIR_CREATE, extractAnimalId: () => null },
  { pattern: /^POST \/breeding\/pairs\/[^/]+\/status$/, op: AUDIT_OPERATIONS.BREEDING_PAIR_STATUS, extractAnimalId: () => null },
  { pattern: /^POST \/breeding\/pairs\/[^/]+\/cancel$/, op: AUDIT_OPERATIONS.BREEDING_PAIR_CANCEL, extractAnimalId: () => null },
  { pattern: /^POST \/breeding\/litters$/, op: AUDIT_OPERATIONS.BREEDING_LITTER_CREATE, extractAnimalId: () => null },
  { pattern: /^POST \/breeding\/litters\/[^/]+\/update$/, op: AUDIT_OPERATIONS.BREEDING_LITTER_UPDATE, extractAnimalId: () => null },
  { pattern: /^POST \/breeding\/litters\/[^/]+\/wean$/, op: AUDIT_OPERATIONS.BREEDING_LITTER_WEAN, extractAnimalIdFromWean },
  { pattern: /^POST \/health-events$/, op: AUDIT_OPERATIONS.HEALTH_EVENT_CREATE, extractAnimalIdFromBody },
  { pattern: /^POST \/health-events\/[^/]+\/assign$/, op: AUDIT_OPERATIONS.HEALTH_EVENT_ASSIGN, extractAnimalIdFromEvent },
  { pattern: /^POST \/health-events\/[^/]+\/notes$/, op: AUDIT_OPERATIONS.HEALTH_EVENT_NOTE, extractAnimalIdFromEvent },
  { pattern: /^POST \/health-events\/[^/]+\/close$/, op: AUDIT_OPERATIONS.HEALTH_EVENT_CLOSE, extractAnimalIdFromEvent },
  { pattern: /^POST \/health-events\/migrate-historical$/, op: AUDIT_OPERATIONS.HEALTH_MIGRATE, extractAnimalId: () => null },
  { pattern: /^POST \/sync\/batch$/, op: AUDIT_OPERATIONS.SYNC_BATCH, extractAnimalId: extractSyncAnimalIds },
  { pattern: /^GET \/sync\/operations\/?[^/]*$/, op: AUDIT_OPERATIONS.SYNC_OPERATION_QUERY, extractAnimalId: () => null }
];

function extractAnimalIdFromPath(method, pathname, req, res, db) {
  const match = pathname.match(/^\/animals\/([^/]+)/);
  return match ? match[1] : null;
}

function extractAnimalIdFromTarget(method, pathname, req, res, db) {
  const body = (req && req._auditBody) || {};
  if (body.targetType === "animal") return body.targetId || null;
  if (body.targetType === "cage" && body.targetId) {
    const inCage = (db.animals || []).filter((a) => a.cageId === body.targetId).map((a) => a.id);
    return inCage.length > 0 ? inCage : null;
  }
  return null;
}

function extractAnimalIdFromWean(method, pathname, req, res, db) {
  if (res && Array.isArray(res.offspring)) {
    return res.offspring.map((a) => a.id).filter(Boolean);
  }
  return null;
}

function extractAnimalIdFromBody(method, pathname, req, res, db) {
  const body = (req && req._auditBody) || {};
  return body.animalId || null;
}

function extractAnimalIdFromEvent(method, pathname, req, res, db) {
  if (res && res.animalId) return res.animalId;
  const match = pathname.match(/^\/health-events\/([^/]+)/);
  if (!match || !db) return null;
  const event = (db.healthEvents || []).find((e) => e.id === match[1]);
  return event ? event.animalId : null;
}

function extractSyncAnimalIds(method, pathname, req, res, db) {
  const animalIds = new Set();
  const body = (req && req._auditBody) || {};
  const operations = Array.isArray(body.operations) ? body.operations : [];

  for (const op of operations) {
    const payload = op.payload || {};
    if (op.operationType === "animal_note" || op.operationType === "animal_move") {
      if (payload.animalId) animalIds.add(payload.animalId);
    } else if (op.operationType === "feeding_record" && payload.targetType === "animal") {
      if (payload.targetId) animalIds.add(payload.targetId);
    }
  }

  if (res && Array.isArray(res.results)) {
    for (const r of res.results) {
      if (r.data?.note && (req?._auditBody?.operations || []).find((o) => o.operationId === r.operationId)?.operationType === "animal_note") {
        const op = (req?._auditBody?.operations || []).find((o) => o.operationId === r.operationId);
        if (op?.payload?.animalId) animalIds.add(op.payload.animalId);
      }
    }
  }

  return Array.from(animalIds);
}

export function resolveAuditOperation(method, pathname, req, responseData, db) {
  const key = `${method} ${pathname}`;
  for (const rule of writeOperationPatterns) {
    if (rule.pattern.test(key)) {
      let animalIds = [];
      try {
        const extracted = rule.extractAnimalId(method, pathname, req, responseData, db);
        if (Array.isArray(extracted)) {
          animalIds = extracted;
        } else if (extracted) {
          animalIds = [extracted];
        }
      } catch (e) {
        animalIds = [];
      }
      return { shouldAudit: true, operation: rule.op, animalIds };
    }
  }
  return { shouldAudit: false };
}

async function loadAuditStore() {
  if (!existsSync(auditPath)) {
    return { logs: [], nextId: 1 };
  }
  try {
    const raw = await readFile(auditPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      nextId: typeof parsed.nextId === "number" ? parsed.nextId : (parsed.logs?.length || 0) + 1
    };
  } catch (e) {
    return { logs: [], nextId: 1 };
  }
}

async function saveAuditStore(store) {
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(auditPath, JSON.stringify(store, null, 2));
}

export async function writeAuditLog(params) {
  const {
    operation,
    principal,
    method,
    pathname,
    query,
    requestBody,
    responseBody,
    responseStatus,
    animalIds,
    ip,
    userAgent
  } = params;

  const store = await loadAuditStore();
  const entry = {
    id: `audit-${store.nextId}`,
    timestamp: new Date().toISOString(),
    operation,
    operator: principal ? {
      key: principal.key,
      role: principal.role,
      name: principal.name
    } : null,
    request: {
      method,
      pathname,
      query: query || null,
      body: sanitizeBody(requestBody),
      ip: ip || null,
      userAgent: userAgent || null
    },
    response: {
      status: responseStatus,
      body: sanitizeBody(responseBody)
    },
    animalIds: Array.isArray(animalIds) ? animalIds.filter(Boolean) : []
  };

  store.logs.push(entry);
  store.nextId += 1;
  await saveAuditStore(store);
  return entry;
}

function sanitizeBody(body) {
  if (body == null) return null;
  try {
    const json = typeof body === "string" ? body : JSON.stringify(body);
    if (json.length > 5000) {
      return { _truncated: true, length: json.length, preview: json.substring(0, 500) };
    }
    return JSON.parse(json);
  } catch (e) {
    return { _error: "unserializable", type: typeof body };
  }
}

export async function queryAuditLogs(filters = {}) {
  const store = await loadAuditStore();
  let logs = [...store.logs];

  if (filters.animalId) {
    const target = filters.animalId;
    logs = logs.filter((log) =>
      Array.isArray(log.animalIds) && log.animalIds.includes(target)
    );
  }

  if (filters.operatorKey) {
    logs = logs.filter((log) => log.operator?.key === filters.operatorKey);
  }

  if (filters.operatorName) {
    const name = filters.operatorName.toLowerCase();
    logs = logs.filter((log) => log.operator?.name?.toLowerCase().includes(name));
  }

  if (filters.role) {
    logs = logs.filter((log) => log.operator?.role === filters.role);
  }

  if (filters.operation) {
    logs = logs.filter((log) => log.operation === filters.operation);
  }

  if (filters.method) {
    logs = logs.filter((log) => log.request?.method === filters.method);
  }

  if (filters.fromDate) {
    const from = new Date(filters.fromDate).getTime();
    if (!isNaN(from)) {
      logs = logs.filter((log) => new Date(log.timestamp).getTime() >= from);
    }
  }

  if (filters.toDate) {
    const to = new Date(filters.toDate).getTime();
    if (!isNaN(to)) {
      logs = logs.filter((log) => new Date(log.timestamp).getTime() <= to);
    }
  }

  if (filters.statusCode) {
    const sc = Number(filters.statusCode);
    if (!isNaN(sc)) {
      logs = logs.filter((log) => log.response?.status === sc);
    }
  }

  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const limit = Number(filters.limit) || 100;
  const offset = Number(filters.offset) || 0;

  return {
    total: logs.length,
    limit,
    offset,
    logs: logs.slice(offset, offset + limit)
  };
}

export async function getAuditLogById(id) {
  const store = await loadAuditStore();
  return store.logs.find((log) => log.id === id) || null;
}

export async function getAuditStats(filters = {}) {
  const store = await loadAuditStore();
  let logs = [...store.logs];

  if (filters.fromDate) {
    const from = new Date(filters.fromDate).getTime();
    if (!isNaN(from)) logs = logs.filter((l) => new Date(l.timestamp).getTime() >= from);
  }
  if (filters.toDate) {
    const to = new Date(filters.toDate).getTime();
    if (!isNaN(to)) logs = logs.filter((l) => new Date(l.timestamp).getTime() <= to);
  }

  const byOperation = {};
  const byOperator = {};
  const byStatus = {};
  const byAnimal = {};

  for (const log of logs) {
    byOperation[log.operation] = (byOperation[log.operation] || 0) + 1;
    if (log.operator?.name) {
      byOperator[log.operator.name] = (byOperator[log.operator.name] || 0) + 1;
    }
    const st = String(log.response?.status || "unknown");
    byStatus[st] = (byStatus[st] || 0) + 1;
    for (const aid of log.animalIds || []) {
      byAnimal[aid] = (byAnimal[aid] || 0) + 1;
    }
  }

  const topAnimals = Object.entries(byAnimal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ animalId: id, count }));

  return {
    total: logs.length,
    byOperation,
    byOperator,
    byStatus,
    topAnimals
  };
}

export function getAuditOperations() {
  return JSON.parse(JSON.stringify(AUDIT_OPERATIONS));
}
