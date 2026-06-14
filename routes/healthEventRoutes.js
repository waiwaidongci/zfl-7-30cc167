import { send, body, saveDb } from "../lib/helpers.js";
import {
  listHealthEvents,
  getHealthEvent,
  createHealthEvent,
  assignHealthEvent,
  addEventNote,
  closeHealthEvent,
  getHealthEventStats,
  migrateHistoricalNotes,
  EVENT_STATUS,
  ABNORMAL_KEYWORDS,
  WEIGHT_CHANGE_THRESHOLD,
  detectAbnormalKeywords,
  calculateWeightChange
} from "../lib/healthEventData.js";
import { getAnimal } from "../lib/animalData.js";

export async function handleHealthEventRoutes(req, res, url, db) {
  if (handleMeta(req, res, url, db)) return true;
  if (handleStats(req, res, url, db)) return true;
  if (handleMigration(req, res, url, db)) return true;
  if (handleDetection(req, res, url, db)) return true;
  if (handleList(req, res, url, db)) return true;
  if (handleCreate(req, res, url, db)) return true;
  if (handleDetailActions(req, res, url, db)) return true;
  return false;
}

function handleMeta(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/health-events/meta") {
    send(res, 200, {
      statuses: EVENT_STATUS,
      abnormalKeywords: ABNORMAL_KEYWORDS,
      weightThreshold: WEIGHT_CHANGE_THRESHOLD
    });
    return true;
  }
  return false;
}

function handleStats(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/health-events/stats") {
    const filters = {
      project: url.searchParams.get("project"),
      keeper: url.searchParams.get("keeper"),
      handler: url.searchParams.get("handler"),
      assignee: url.searchParams.get("assignee"),
      fromDate: url.searchParams.get("fromDate"),
      toDate: url.searchParams.get("toDate")
    };
    send(res, 200, getHealthEventStats(db, filters));
    return true;
  }
  return false;
}

function handleMigration(req, res, url, db) {
  if (req.method === "POST" && url.pathname === "/health-events/migrate-historical") {
    const result = migrateHistoricalNotes(db);
    saveDb(db);
    send(res, 200, result);
    return true;
  }
  return false;
}

function handleDetection(req, res, url, db) {
  if (req.method === "POST" && url.pathname === "/health-events/detect") {
    handleDetect(req, res, db);
    return true;
  }
  return false;
}

async function handleDetect(req, res, db) {
  const input = await body(req);
  if (!input.animalId) {
    return send(res, 400, { error: "animalId_required" });
  }
  const animal = getAnimal(db, input.animalId);
  if (!animal) {
    return send(res, 404, { error: "animal_not_found" });
  }
  const keywords = detectAbnormalKeywords(input.condition || "");
  let weightResult = null;
  if (input.weight != null) {
    weightResult = calculateWeightChange(animal, input.weight);
  }
  send(res, 200, {
    animalId: input.animalId,
    condition: input.condition || "",
    detectedKeywords: keywords,
    weightChange: weightResult,
    wouldTriggerEvent: keywords.length > 0 || (weightResult && weightResult.isAbnormal),
    reason:
      keywords.length > 0
        ? `检测到异常关键词：${keywords.join("、")}`
        : weightResult && weightResult.isAbnormal
        ? `体重变化${weightResult.percent.toFixed(1)}%超过阈值${weightResult.threshold}%`
        : "未检测到异常"
  });
}

function handleList(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/health-events") {
    const filters = {
      status: url.searchParams.get("status"),
      project: url.searchParams.get("project"),
      keeper: url.searchParams.get("keeper"),
      handler: url.searchParams.get("handler"),
      animalId: url.searchParams.get("animalId"),
      source: url.searchParams.get("source"),
      fromDate: url.searchParams.get("fromDate"),
      toDate: url.searchParams.get("toDate")
    };
    send(res, 200, listHealthEvents(db, filters));
    return true;
  }
  return false;
}

function handleCreate(req, res, url, db) {
  if (req.method === "POST" && url.pathname === "/health-events") {
    handleCreateEvent(req, res, db);
    return true;
  }
  return false;
}

async function handleCreateEvent(req, res, db) {
  const input = await body(req);
  if (!input.animalId) {
    return send(res, 400, { error: "animalId_required" });
  }
  const animal = getAnimal(db, input.animalId);
  if (!animal) {
    return send(res, 404, { error: "animal_not_found" });
  }
  if (!input.condition && !input.abnormalKeywords?.length) {
    return send(res, 400, { error: "condition_or_keywords_required" });
  }
  const event = createHealthEvent(db, input);
  await saveDb(db);
  send(res, 201, event);
}

function handleDetailActions(req, res, url, db) {
  const detailMatch = url.pathname.match(/^\/health-events\/([^/]+)(?:\/([^/]+))?$/);
  if (!detailMatch) return false;
  const [, id, action] = detailMatch;

  if (req.method === "GET" && !action) {
    const event = getHealthEvent(db, id);
    if (!event) {
      send(res, 404, { error: "event_not_found" });
      return true;
    }
    send(res, 200, event);
    return true;
  }

  if (req.method === "POST" && action === "assign") {
    handleAssign(req, res, db, id);
    return true;
  }

  if (req.method === "POST" && action === "notes") {
    handleAddNote(req, res, db, id);
    return true;
  }

  if (req.method === "POST" && action === "close") {
    handleClose(req, res, db, id);
    return true;
  }

  return false;
}

async function handleAssign(req, res, db, id) {
  const event = getHealthEvent(db, id);
  if (!event) {
    return send(res, 404, { error: "event_not_found" });
  }
  const input = await body(req);
  if (!input.assignee) {
    return send(res, 400, { error: "assignee_required" });
  }
  const result = assignHealthEvent(db, id, input.assignee);
  if (result.error) {
    return send(res, 422, { error: result.error, message: result.message });
  }
  await saveDb(db);
  send(res, 200, result);
}

async function handleAddNote(req, res, db, id) {
  const event = getHealthEvent(db, id);
  if (!event) {
    return send(res, 404, { error: "event_not_found" });
  }
  const input = await body(req);
  if (!input.content) {
    return send(res, 400, { error: "content_required" });
  }
  const result = addEventNote(db, id, input);
  await saveDb(db);
  send(res, 200, result);
}

async function handleClose(req, res, db, id) {
  const event = getHealthEvent(db, id);
  if (!event) {
    return send(res, 404, { error: "event_not_found" });
  }
  const input = await body(req);
  const result = closeHealthEvent(db, id, input || {});
  if (result.error) {
    return send(res, 422, { error: result.error, message: result.message });
  }
  await saveDb(db);
  send(res, 200, result);
}
