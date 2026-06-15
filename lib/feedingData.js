import { localDate } from "./helpers.js";
import { EVENT_TYPES, recordEvent } from "./eventLedger.js";
import { DEFAULT_ROOM_ID } from "./facilityData.js";
import { getCage } from "./cageData.js";
import { getAnimal } from "./animalData.js";

function resolveRoomIdFromTarget(db, targetType, targetId) {
  if (targetType === "cage" && targetId) {
    const cage = getCage(db, targetId);
    return cage?.roomId || DEFAULT_ROOM_ID;
  }
  if (targetType === "animal" && targetId) {
    const animal = getAnimal(db, targetId);
    if (animal?.cageId) {
      const cage = getCage(db, animal.cageId);
      return cage?.roomId || animal?.roomId || DEFAULT_ROOM_ID;
    }
    return animal?.roomId || DEFAULT_ROOM_ID;
  }
  return DEFAULT_ROOM_ID;
}

function resolveZoneIdFromTarget(db, targetType, targetId) {
  if (targetType === "cage" && targetId) {
    const cage = getCage(db, targetId);
    return cage?.zoneId || null;
  }
  if (targetType === "animal" && targetId) {
    const animal = getAnimal(db, targetId);
    if (animal?.cageId) {
      const cage = getCage(db, animal.cageId);
      return cage?.zoneId || animal?.zoneId || null;
    }
    return animal?.zoneId || null;
  }
  return null;
}

function resolveProjectFromTarget(db, targetType, targetId) {
  if (targetType === "animal" && targetId) {
    const animal = getAnimal(db, targetId);
    return animal?.project || null;
  }
  return null;
}

function resolveProjectIdFromTarget(db, targetType, targetId) {
  if (targetType === "animal" && targetId) {
    const animal = getAnimal(db, targetId);
    return animal?.projectId || null;
  }
  return null;
}

export function ensureFeedingCollections(db) {
  if (!db.feedingPlans) db.feedingPlans = [];
  if (!db.feedingRecords) db.feedingRecords = [];
}

export function listFeedingPlans(db, filters = {}) {
  ensureFeedingCollections(db);
  let plans = [...db.feedingPlans];
  if (filters.targetType) plans = plans.filter((p) => p.targetType === filters.targetType);
  if (filters.targetId) plans = plans.filter((p) => p.targetId === filters.targetId);
  if (filters.status) plans = plans.filter((p) => p.status === filters.status);
  if (filters.keeper) plans = plans.filter((p) => p.keeper === filters.keeper);
  if (filters.roomId) plans = plans.filter((p) => p.roomId === filters.roomId);
  if (filters.project) plans = plans.filter((p) => p.project === filters.project);
  return plans.map(enrichPlan);
}

export function getFeedingPlan(db, id) {
  ensureFeedingCollections(db);
  const plan = db.feedingPlans.find((p) => p.id === id);
  if (!plan) return null;
  return enrichPlan(plan);
}

export function addFeedingPlan(db, input) {
  ensureFeedingCollections(db);
  const roomId = input.roomId || resolveRoomIdFromTarget(db, input.targetType, input.targetId);
  const zoneId = input.zoneId || resolveZoneIdFromTarget(db, input.targetType, input.targetId);
  const project = input.project || resolveProjectFromTarget(db, input.targetType, input.targetId);
  const projectId = input.projectId || resolveProjectIdFromTarget(db, input.targetType, input.targetId);
  const plan = {
    id: input.id || `plan-${Date.now()}`,
    targetType: input.targetType,
    targetId: input.targetId,
    roomId,
    zoneId,
    project,
    projectId,
    feedType: input.feedType,
    feedTimes: input.feedTimes || [],
    dailyAmount: input.dailyAmount || 0,
    keeper: input.keeper,
    status: "active",
    startDate: input.startDate || localDate(),
    endDate: input.endDate || null,
    createdAt: new Date().toISOString(),
    notes: input.notes || ""
  };
  db.feedingPlans.push(plan);
  return enrichPlan(plan);
}

export function disableFeedingPlan(db, id) {
  ensureFeedingCollections(db);
  const plan = db.feedingPlans.find((p) => p.id === id);
  if (!plan) return null;
  plan.status = "inactive";
  plan.disabledAt = new Date().toISOString();
  return enrichPlan(plan);
}

export function listFeedingRecords(db, filters = {}) {
  ensureFeedingCollections(db);
  let records = [...db.feedingRecords];
  if (filters.planId) records = records.filter((r) => r.planId === filters.planId);
  if (filters.targetType) records = records.filter((r) => r.targetType === filters.targetType);
  if (filters.targetId) records = records.filter((r) => r.targetId === filters.targetId);
  if (filters.date) records = records.filter((r) => r.date === filters.date);
  if (filters.keeper) records = records.filter((r) => r.keeper === filters.keeper);
  if (filters.status) records = records.filter((r) => r.status === filters.status);
  if (filters.roomId) records = records.filter((r) => r.roomId === filters.roomId);
  if (filters.project) records = records.filter((r) => r.project === filters.project);
  return records.sort((a, b) => b.actualTime.localeCompare(a.actualTime));
}

export function getFeedingRecord(db, id) {
  ensureFeedingCollections(db);
  return db.feedingRecords.find((r) => r.id === id) || null;
}

export async function addFeedingRecord(db, input, options = {}) {
  ensureFeedingCollections(db);
  const roomId = input.roomId || resolveRoomIdFromTarget(db, input.targetType, input.targetId);
  const zoneId = input.zoneId || resolveZoneIdFromTarget(db, input.targetType, input.targetId);
  const project = input.project || resolveProjectFromTarget(db, input.targetType, input.targetId);
  const projectId = input.projectId || resolveProjectIdFromTarget(db, input.targetType, input.targetId);
  const record = {
    id: input.id || `record-${Date.now()}`,
    planId: input.planId,
    targetType: input.targetType,
    targetId: input.targetId,
    roomId,
    zoneId,
    project,
    projectId,
    date: input.date || localDate(),
    scheduledTime: input.scheduledTime || null,
    actualTime: input.actualTime || new Date().toISOString(),
    feedType: input.feedType,
    amount: input.amount || 0,
    keeper: input.keeper,
    status: input.status || "completed",
    condition: input.condition || "",
    weight: input.weight != null ? input.weight : null,
    notes: input.notes || ""
  };
  db.feedingRecords.push(record);

  if (!options.skipEvent && record.targetType === "animal") {
    await recordEvent(EVENT_TYPES.FEEDING_RECORDED, {
      recordId: record.id,
      planId: record.planId,
      feedType: record.feedType,
      amount: record.amount,
      condition: record.condition,
      weight: record.weight,
      notes: record.notes,
      date: record.date,
      roomId: record.roomId
    }, {
      animalId: record.targetId,
      roomId: record.roomId || null,
      zoneId: record.zoneId || null,
      projectId: record.projectId || null,
      operator: options.operator || null,
      metadata: options.metadata || null
    });
  }

  return record;
}

function enrichPlan(plan) {
  return { ...plan, feedCount: plan.feedTimes ? plan.feedTimes.length : 0 };
}
