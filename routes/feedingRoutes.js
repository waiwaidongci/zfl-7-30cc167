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
  getFeedingHistory,
  getFeedingSchedule,
  validateDateRange,
  getDefaultDateRange
} from "../lib/feedingScheduler.js";
import { detectAndCreateEvent } from "../lib/healthEventData.js";
import { checkRoomWriteAccess } from "../lib/permissions.js";
import { resolveTargetOwnership } from "../lib/targetOwnership.js";

export async function handleFeedingRoutes(req, res, url, db) {
  if (handlePlans(req, res, url, db)) return true;
  if (handleToday(req, res, url, db)) return true;
  if (handleSchedule(req, res, url, db)) return true;
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
      keeper: url.searchParams.get("keeper"),
      roomId: url.searchParams.get("roomId") || undefined,
      project: url.searchParams.get("project") || undefined
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
  const targetRoomId = resolveTargetOwnership(db, { targetType: input.targetType, targetId: input.targetId }).roomId;
  const roomCheck = checkRoomWriteAccess(req._principal, targetRoomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
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

function handleSchedule(req, res, url, db) {
  if (req.method !== "GET") return false;

  if (url.pathname === "/feeding/schedule" || url.pathname === "/feeding/schedule/summary") {
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const targetType = url.searchParams.get("targetType");
    const keeper = url.searchParams.get("keeper");
    const roomId = url.searchParams.get("roomId");

    if (dateFrom || dateTo) {
      const check = validateDateRange(
        dateFrom || getDefaultDateRange().dateFrom,
        dateTo || getDefaultDateRange().dateTo
      );
      if (!check.valid) {
        send(res, 400, { error: check.error, message: check.message });
        return true;
      }
    }

    const options = {
      dateFrom,
      dateTo,
      targetType,
      keeper,
      roomId,
      principal: req._principal || null
    };

    const result = getFeedingSchedule(db, options);
    if (result.error) {
      send(res, 400, result);
      return true;
    }

    if (url.pathname === "/feeding/schedule/summary") {
      const summary = {
        dateFrom: result.dateFrom,
        dateTo: result.dateTo,
        days: result.days,
        filters: result.filters,
        overall: result.overall,
        dailySchedule: result.dailySchedule.map((d) => ({
          date: d.date,
          total: d.total,
          completed: d.completed,
          pending: d.pending,
          completionRate: d.completionRate,
          missedRisk: d.missedRisk,
          byKeeper: d.byKeeper,
          taskCount: d.tasks.length
        }))
      };
      send(res, 200, summary);
    } else {
      send(res, 200, result);
    }
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
      status: url.searchParams.get("status"),
      roomId: url.searchParams.get("roomId") || undefined,
      project: url.searchParams.get("project") || undefined
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

  const targetRoomId = resolveTargetOwnership(db, { targetType: input.targetType, targetId: input.targetId }).roomId;
  const roomCheck = checkRoomWriteAccess(req._principal, targetRoomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
  }

  const record = await addFeedingRecord(db, input, { operator: req._principal });

  const healthResults = [];
  if (input.targetType === "animal") {
    const condition = input.condition || input.notes || "";
    const weight = input.weight;
    if (condition || weight != null) {
      const result = await detectAndCreateEvent(db, {
        animalId: input.targetId,
        condition,
        weight,
        source: "feeding_checkin",
        sourceRecordId: record.id,
        keeper: input.keeper
      });
      if (result.created) {
        healthResults.push(result);
      }
    }
  } else if (input.targetType === "cage") {
    const animalsInCage = (db.animals || []).filter(a => a.cageId === input.targetId);
    const condition = input.condition || input.notes || "";
    if (condition) {
      for (const animal of animalsInCage) {
        const result = await detectAndCreateEvent(db, {
          animalId: animal.id,
          condition,
          weight: input.weight,
          source: "feeding_checkin_cage",
          sourceRecordId: record.id,
          keeper: input.keeper
        });
        if (result.created) {
          healthResults.push({ animalId: animal.id, ...result });
        }
      }
    }
  }

  await saveDb(db);

  const responseData = healthResults.length > 0
    ? { ...record, healthEvents: healthResults.map(r => ({
        created: r.created,
        merged: r.merged || false,
        eventId: r.event ? r.event.id : null,
        event: r.event || null
      })) }
    : record;

  send(res, 201, responseData);
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
