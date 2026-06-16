import { localDate } from "./helpers.js";
import { EVENT_TYPES, recordEvent } from "./eventLedger.js";
import { DEFAULT_ROOM_ID } from "./facilityData.js";
import { resolveTargetOwnershipWithDefaults } from "./targetOwnership.js";

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
  const ownership = resolveTargetOwnershipWithDefaults(db, { targetType: input.targetType, targetId: input.targetId });
  const roomId = input.roomId || ownership.roomId;
  const zoneId = input.zoneId || ownership.zoneId;
  const project = input.project || ownership.project;
  const projectId = input.projectId || ownership.projectId;
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
  const ownership = resolveTargetOwnershipWithDefaults(db, { targetType: input.targetType, targetId: input.targetId });
  const roomId = input.roomId || ownership.roomId;
  const zoneId = input.zoneId || ownership.zoneId;
  const project = input.project || ownership.project;
  const projectId = input.projectId || ownership.projectId;
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
