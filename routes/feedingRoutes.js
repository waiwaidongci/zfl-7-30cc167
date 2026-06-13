import { send, body, saveDb } from "../lib/helpers.js";
import {
  listFeedingPlans,
  getFeedingPlan,
  addFeedingPlan,
  disableFeedingPlan,
  listFeedingRecords,
  addFeedingRecord,
  getFeedingRecord
} from "../lib/feedingData.js";
import {
  getTodayTasks,
  getTodaySummary,
  getFeedingHistory
} from "../lib/feedingScheduler.js";

export async function handleFeedingRoutes(req, res, url, db) {
  if (handlePlans(req, res, url, db)) return true;
  if (handleToday(req, res, url, db)) return true;
  if (handleRecords(req, res, url, db)) return true;
  if (handleHistory(req, res, url, db)) return true;
  return false;
}

function handlePlans(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/feeding/plans") {
    const filters = {
      targetType: url.searchParams.get("targetType"),
      targetId: url.searchParams.get("targetId"),
      status: url.searchParams.get("status"),
      keeper: url.searchParams.get("keeper")
    };
    send(res, 200, listFeedingPlans(db, filters));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/feeding/plans") {
    handleAddPlan(req, res, db);
    return true;
  }

  const planMatch = url.pathname.match(/^\/feeding\/plans\/([^/]+)$/);
  if (planMatch && req.method === "GET") {
    const plan = getFeedingPlan(db, planMatch[1]);
    if (!plan) { send(res, 404, { error: "plan_not_found" }); return true; }
    send(res, 200, plan);
    return true;
  }

  const disableMatch = url.pathname.match(/^\/feeding\/plans\/([^/]+)\/disable$/);
  if (disableMatch && req.method === "POST") {
    const plan = disableFeedingPlan(db, disableMatch[1]);
    if (!plan) { send(res, 404, { error: "plan_not_found" }); return true; }
    saveDb(db);
    send(res, 200, plan);
    return true;
  }

  return false;
}

async function handleAddPlan(req, res, db) {
  const input = await body(req);
  if (!input.targetType || !input.targetId || !input.feedType || !input.keeper) {
    return send(res, 400, { error: "missing_required_fields", fields: ["targetType", "targetId", "feedType", "keeper"] });
  }
  if (!["animal", "cage"].includes(input.targetType)) {
    return send(res, 400, { error: "invalid_target_type", allowed: ["animal", "cage"] });
  }
  if (input.feedTimes && !Array.isArray(input.feedTimes)) {
    return send(res, 400, { error: "feedTimes_must_be_array" });
  }
  const plan = addFeedingPlan(db, input);
  await saveDb(db);
  send(res, 201, plan);
}

function handleToday(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/feeding/today") {
    const options = {
      targetType: url.searchParams.get("targetType"),
      keeper: url.searchParams.get("keeper"),
      date: url.searchParams.get("date")
    };
    send(res, 200, getTodayTasks(db, options));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/feeding/today/summary") {
    const options = {
      targetType: url.searchParams.get("targetType"),
      keeper: url.searchParams.get("keeper"),
      date: url.searchParams.get("date")
    };
    send(res, 200, getTodaySummary(db, options));
    return true;
  }

  return false;
}

function handleRecords(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/feeding/records") {
    const filters = {
      planId: url.searchParams.get("planId"),
      targetType: url.searchParams.get("targetType"),
      targetId: url.searchParams.get("targetId"),
      date: url.searchParams.get("date"),
      keeper: url.searchParams.get("keeper"),
      status: url.searchParams.get("status")
    };
    send(res, 200, listFeedingRecords(db, filters));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/feeding/checkin") {
    handleCheckin(req, res, db);
    return true;
  }

  const recordMatch = url.pathname.match(/^\/feeding\/records\/([^/]+)$/);
  if (recordMatch && req.method === "GET") {
    const record = getFeedingRecord(db, recordMatch[1]);
    if (!record) { send(res, 404, { error: "record_not_found" }); return true; }
    send(res, 200, record);
    return true;
  }

  return false;
}

async function handleCheckin(req, res, db) {
  const input = await body(req);
  if (!input.planId && (!input.targetType || !input.targetId)) {
    return send(res, 400, { error: "planId_or_target_required" });
  }
  if (!input.keeper) {
    return send(res, 400, { error: "keeper_required" });
  }

  if (input.planId) {
    const plan = getFeedingPlan(db, input.planId);
    if (!plan) {
      return send(res, 404, { error: "plan_not_found" });
    }
    if (plan.status !== "active") {
      return send(res, 400, { error: "plan_not_active" });
    }
    if (!input.targetType) input.targetType = plan.targetType;
    if (!input.targetId) input.targetId = plan.targetId;
    if (!input.feedType) input.feedType = plan.feedType;
  }

  const record = addFeedingRecord(db, input);
  await saveDb(db);
  send(res, 201, record);
}

function handleHistory(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/feeding/history") {
    const options = {
      days: Number(url.searchParams.get("days") || 7),
      targetType: url.searchParams.get("targetType"),
      targetId: url.searchParams.get("targetId"),
      keeper: url.searchParams.get("keeper")
    };
    send(res, 200, getFeedingHistory(db, options));
    return true;
  }
  return false;
}
