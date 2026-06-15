import { getAnimal } from "./animalData.js";
import { getCage } from "./cageData.js";
import { DEFAULT_ROOM_ID } from "./facilityData.js";
import { EVENT_TYPES, recordEvent } from "./eventLedger.js";

export const EVENT_STATUS = {
  PENDING: "pending",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  CLOSED: "closed"
};

export const EVENT_STATUS_LABELS = {
  [EVENT_STATUS.PENDING]: "待处理",
  [EVENT_STATUS.ASSIGNED]: "已分派",
  [EVENT_STATUS.IN_PROGRESS]: "处理中",
  [EVENT_STATUS.CLOSED]: "已关闭"
};

export const EVENT_SEVERITY = {
  NORMAL: "normal",
  WARNING: "warning",
  CRITICAL: "critical"
};

export const EVENT_SEVERITY_LABELS = {
  [EVENT_SEVERITY.NORMAL]: "一般",
  [EVENT_SEVERITY.WARNING]: "警告",
  [EVENT_SEVERITY.CRITICAL]: "严重"
};

export const ACTIVE_EVENT_STATUSES = [
  EVENT_STATUS.PENDING,
  EVENT_STATUS.ASSIGNED,
  EVENT_STATUS.IN_PROGRESS
];

export const ABNORMAL_KEYWORDS = [
  "食欲下降", "食欲差", "食欲减退", "食欲不振", "不吃", "拒食",
  "消瘦", "体重下降", "体重减轻", "掉膘",
  "腹泻", "拉稀", "软便", "粪便异常",
  "发热", "发烧", "体温高",
  "精神差", "萎靡", "呆滞", "活动减少", "嗜睡",
  "毛发杂乱", "毛发粗糙", "脱毛", "掉毛",
  "咳嗽", "打喷嚏", "呼吸急促", "气喘", "呼吸困难",
  "伤口", "溃疡", "出血", "红肿", "发炎",
  "跛行", "行动异常", "抽搐", "痉挛",
  "呕吐", "反胃",
  "眼睛异常", "眼屎", "流泪",
  "鼻子异常", "流涕",
  "异常", "待观察", "疑似"
];

export const WEIGHT_CHANGE_THRESHOLD = {
  WEEKLY_LOSS_PERCENT: 10,
  DAILY_LOSS_PERCENT: 5
};

const MERGE_WINDOW_DAYS = 3;

export function ensureHealthCollections(db) {
  if (!db.healthEvents) db.healthEvents = [];
}

export function listHealthEvents(db, filters = {}) {
  let events = db.healthEvents ? [...db.healthEvents] : [];
  if (filters.status) events = events.filter((e) => e.status === filters.status);
  if (filters.project) events = events.filter((e) => e.project === filters.project);
  if (filters.keeper) events = events.filter((e) => e.keeper === filters.keeper);
  if (filters.handler) events = events.filter((e) => e.handler === filters.handler);
  if (filters.severity) events = events.filter((e) => (e.severity || EVENT_SEVERITY.NORMAL) === filters.severity);
  if (filters.animalId) events = events.filter((e) => e.animalId === filters.animalId);
  if (filters.source) events = events.filter((e) => e.source === filters.source);
  if (filters.overdue === "true") events = events.filter((e) => isEventOverdue(e));
  if (filters.overdue === "false") events = events.filter((e) => !isEventOverdue(e));
  if (filters.fromDate) events = events.filter((e) => e.createdAt.slice(0, 10) >= filters.fromDate);
  if (filters.toDate) events = events.filter((e) => e.createdAt.slice(0, 10) <= filters.toDate);
  if (filters.roomId) events = events.filter((e) => e.roomId === filters.roomId);
  return events
    .map((e) => ({ ...e, isOverdue: isEventOverdue(e) }))
    .sort((a, b) => {
      const sevDiff = severityRank(b.severity) - severityRank(a.severity);
      if (sevDiff !== 0) return sevDiff;
      const overdueDiff = (b.isOverdue ? 1 : 0) - (a.isOverdue ? 1 : 0);
      if (overdueDiff !== 0) return overdueDiff;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

function getHealthEventRef(db, id) {
  if (!db.healthEvents) return null;
  return db.healthEvents.find((e) => e.id === id) || null;
}

export function getHealthEvent(db, id) {
  const event = getHealthEventRef(db, id);
  if (!event) return null;
  return { ...event, isOverdue: isEventOverdue(event) };
}

export function detectAbnormalKeywords(text) {
  if (!text) return [];
  const found = [];
  for (const kw of ABNORMAL_KEYWORDS) {
    if (text.includes(kw)) {
      found.push(kw);
    }
  }
  return found;
}

export function calculateWeightChange(animal, currentWeight) {
  if (!animal || currentWeight == null) return null;
  const weightRecords = [];
  if (animal.notes && animal.notes.length) {
    for (const n of animal.notes) {
      if (n.weight != null && n.date) {
        weightRecords.push({ weight: n.weight, date: n.date });
      }
    }
  }
  if (animal.quarantineRecords && animal.quarantineRecords.length) {
    for (const q of animal.quarantineRecords) {
      if (q.weight != null && q.date) {
        weightRecords.push({ weight: q.weight, date: q.date });
      }
    }
  }
  weightRecords.sort((a, b) => b.date.localeCompare(a.date));
  if (weightRecords.length === 0) return null;
  const previous = weightRecords[0];
  const diff = currentWeight - previous.weight;
  const percent = previous.weight > 0 ? (diff / previous.weight) * 100 : 0;
  const daysDiff = Math.ceil((new Date().getTime() - new Date(previous.date).getTime()) / 86400000);
  let threshold = WEIGHT_CHANGE_THRESHOLD.WEEKLY_LOSS_PERCENT;
  if (daysDiff >= 0 && daysDiff <= 2) {
    threshold = WEIGHT_CHANGE_THRESHOLD.DAILY_LOSS_PERCENT;
  }
  const isAbnormal = percent < 0 && Math.abs(percent) >= threshold;
  return {
    previousWeight: previous.weight,
    previousDate: previous.date,
    currentWeight,
    diff,
    percent,
    daysDiff,
    threshold,
    isAbnormal
  };
}

export function findMergeableEvent(db, animalId, keywords) {
  ensureHealthCollections(db);
  const now = new Date();
  const windowStart = new Date(now.getTime() - MERGE_WINDOW_DAYS * 86400000).toISOString();
  const activeEvents = db.healthEvents.filter(
    (e) =>
      e.animalId === animalId &&
      ACTIVE_EVENT_STATUSES.includes(e.status) &&
      e.createdAt >= windowStart
  );
  if (activeEvents.length === 0) return null;
  if (keywords && keywords.length > 0) {
    for (const ev of activeEvents) {
      const hasOverlap = keywords.some((k) => ev.abnormalKeywords.includes(k));
      if (hasOverlap) return ev;
    }
  }
  return activeEvents[0];
}

export function isEventOverdue(event) {
  if (!event) return false;
  if (event.status === EVENT_STATUS.CLOSED) return false;
  if (!event.reviewDueAt) return false;
  return new Date(event.reviewDueAt).getTime() < Date.now();
}

export async function createHealthEvent(db, params, options = {}) {
  ensureHealthCollections(db);
  const animal = getAnimal(db, params.animalId);
  const cage = animal ? getCage(db, animal.cageId) : null;
  const roomId = params.roomId || cage?.roomId || animal?.roomId || DEFAULT_ROOM_ID;
  const zoneId = params.zoneId || cage?.zoneId || animal?.zoneId || null;
  const projectId = params.projectId || animal?.projectId || null;
  const event = {
    id: params.id || `hev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    animalId: params.animalId,
    project: animal ? animal.project : params.project || null,
    projectId,
    keeper: animal ? animal.keeper : params.keeper || null,
    roomId,
    zoneId,
    source: params.source || "manual",
    sourceRecordId: params.sourceRecordId || null,
    condition: params.condition || "",
    abnormalKeywords: params.abnormalKeywords || [],
    weightChange: params.weightChange || null,
    severity: params.severity || EVENT_SEVERITY.NORMAL,
    handler: params.handler || null,
    assignee: params.assignee || null,
    status: params.status || EVENT_STATUS.PENDING,
    notes: params.notes || [],
    createdAt: params.createdAt || new Date().toISOString(),
    updatedAt: params.updatedAt || new Date().toISOString(),
    assignedAt: null,
    inProgressAt: null,
    closedAt: null,
    closeReason: null,
    reviewDueAt: params.reviewDueAt || null,
    relatedRecordIds: params.sourceRecordId ? [params.sourceRecordId] : []
  };
  if (params.assignee) {
    event.status = EVENT_STATUS.ASSIGNED;
    event.assignedAt = event.createdAt;
  }
  if (params.handler) {
    event.handler = params.handler;
  }
  db.healthEvents.push(event);

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.HEALTH_EVENT_CREATED, {
      healthEventId: event.id,
      animalId: event.animalId,
      condition: event.condition,
      abnormalKeywords: event.abnormalKeywords,
      severity: event.severity,
      source: event.source
    }, {
      animalId: event.animalId,
      roomId: event.roomId || null,
      zoneId: event.zoneId || null,
      projectId: event.projectId || null,
      operator: options.operator || null,
      metadata: options.metadata || null
    });
  }

  return event;
}

export function mergeToExistingEvent(db, existingEvent, params) {
  ensureHealthCollections(db);
  const now = new Date().toISOString();
  existingEvent.updatedAt = now;
  for (const kw of params.abnormalKeywords || []) {
    if (!existingEvent.abnormalKeywords.includes(kw)) {
      existingEvent.abnormalKeywords.push(kw);
    }
  }
  if (params.condition && !existingEvent.condition.includes(params.condition)) {
    existingEvent.condition = existingEvent.condition
      ? `${existingEvent.condition}；${params.condition}`
      : params.condition;
  }
  if (params.sourceRecordId && !existingEvent.relatedRecordIds.includes(params.sourceRecordId)) {
    existingEvent.relatedRecordIds.push(params.sourceRecordId);
  }
  if (params.weightChange) {
    existingEvent.weightChange = params.weightChange;
  }
  if (params.severity && severityRank(params.severity) > severityRank(existingEvent.severity)) {
    existingEvent.severity = params.severity;
  }
  existingEvent.notes.push({
    id: `hn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "auto_merge",
    content: params.condition || "重复异常合并",
    createdAt: now,
    author: "system",
    keywords: params.abnormalKeywords || []
  });
  return existingEvent;
}

function severityRank(severity) {
  const order = { [EVENT_SEVERITY.NORMAL]: 0, [EVENT_SEVERITY.WARNING]: 1, [EVENT_SEVERITY.CRITICAL]: 2 };
  return order[severity] ?? 0;
}

export async function detectAndCreateEvent(db, params, options = {}) {
  const { animalId, condition, weight, source, sourceRecordId, keeper, severity } = params;
  const keywords = detectAbnormalKeywords(condition);
  const animal = getAnimal(db, animalId);
  let weightResult = null;
  if (weight != null && animal) {
    weightResult = calculateWeightChange(animal, weight);
  }
  const hasKeywordAbnormal = keywords.length > 0;
  const hasWeightAbnormal = weightResult && weightResult.isAbnormal;
  if (!hasKeywordAbnormal && !hasWeightAbnormal) {
    return { created: false, reason: "no_abnormality_detected" };
  }
  const allKeywords = [...keywords];
  if (hasWeightAbnormal) {
    allKeywords.push("体重异常变化");
  }
  const fullCondition = condition || (hasWeightAbnormal ? `体重变化${weightResult.percent.toFixed(1)}%` : "");
  const existing = findMergeableEvent(db, animalId, allKeywords);
  const inferredSeverity = severity || inferSeverityFromKeywords(allKeywords, weightResult);
  const eventParams = {
    animalId,
    condition: fullCondition,
    abnormalKeywords: allKeywords,
    weightChange: weightResult,
    source: source || "feeding_checkin",
    sourceRecordId,
    keeper,
    severity: inferredSeverity
  };
  if (existing) {
    const merged = mergeToExistingEvent(db, existing, eventParams);
    return { created: true, merged: true, event: merged };
  }
  const event = await createHealthEvent(db, eventParams, options);
  return { created: true, merged: false, event };
}

const CRITICAL_KEYWORDS = [
  "抽搐", "痉挛", "呼吸困难", "气喘", "出血", "昏迷", "濒死", "休克",
  "高烧", "高热", "严重腹泻", "大量出血", "无法站立", "瘫痪"
];

const WARNING_KEYWORDS = [
  "食欲下降", "食欲差", "食欲减退", "食欲不振", "不吃", "拒食",
  "消瘦", "体重下降", "体重减轻", "掉膘",
  "腹泻", "拉稀", "软便", "粪便异常",
  "发热", "发烧", "体温高",
  "精神差", "萎靡", "呆滞", "活动减少", "嗜睡",
  "咳嗽", "打喷嚏", "呼吸急促",
  "伤口", "溃疡", "红肿", "发炎",
  "跛行", "行动异常",
  "呕吐", "反胃",
  "眼睛异常", "眼屎", "流泪",
  "鼻子异常", "流涕",
  "毛发杂乱", "毛发粗糙", "脱毛", "掉毛",
  "异常", "待观察", "疑似", "检疫标记异常", "体重异常变化"
];

export function inferSeverityFromKeywords(keywords, weightResult, minSeverity) {
  let result = EVENT_SEVERITY.NORMAL;
  if (minSeverity && severityRank(minSeverity) > severityRank(result)) {
    result = minSeverity;
  }
  if (!keywords || keywords.length === 0) return result;
  for (const kw of keywords) {
    if (CRITICAL_KEYWORDS.includes(kw)) return EVENT_SEVERITY.CRITICAL;
  }
  if (weightResult && weightResult.isAbnormal) {
    if (Math.abs(weightResult.percent) >= 15) return EVENT_SEVERITY.CRITICAL;
    if (severityRank(EVENT_SEVERITY.WARNING) > severityRank(result)) {
      result = EVENT_SEVERITY.WARNING;
    }
  }
  for (const kw of keywords) {
    if (WARNING_KEYWORDS.includes(kw)) {
      if (severityRank(EVENT_SEVERITY.WARNING) > severityRank(result)) {
        result = EVENT_SEVERITY.WARNING;
      }
      break;
    }
  }
  return result;
}

export function assignHealthEvent(db, id, input) {
  const event = getHealthEventRef(db, id);
  if (!event) return null;
  if (event.status === EVENT_STATUS.CLOSED) {
    return { error: "event_closed", message: "已关闭事件无法分派" };
  }
  const assignee = typeof input === "string" ? input : input.assignee;
  const handler = typeof input === "object" ? input.handler : null;
  const reviewDueAt = typeof input === "object" ? input.reviewDueAt : null;
  const now = new Date().toISOString();
  event.assignee = assignee;
  event.updatedAt = now;
  if (handler) event.handler = handler;
  if (reviewDueAt) event.reviewDueAt = reviewDueAt;
  if (event.status === EVENT_STATUS.PENDING) {
    event.status = EVENT_STATUS.ASSIGNED;
    event.assignedAt = now;
  }
  let noteContent = `分派负责人：${assignee}`;
  if (handler && handler !== assignee) noteContent += `；处理人：${handler}`;
  if (reviewDueAt) noteContent += `；预计复查时间：${reviewDueAt}`;
  event.notes.push({
    id: `hn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "assign",
    content: noteContent,
    createdAt: now,
    author: "system"
  });
  return { ...event, isOverdue: isEventOverdue(event) };
}

export function addEventNote(db, id, noteInput) {
  const event = getHealthEventRef(db, id);
  if (!event) return null;
  const now = new Date().toISOString();
  const note = {
    id: `hn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: noteInput.type || "processing",
    content: noteInput.content,
    createdAt: now,
    author: noteInput.author || (event.handler || event.assignee || "system"),
    metadata: noteInput.metadata || null
  };
  event.notes.push(note);
  event.updatedAt = now;
  if (noteInput.handler) {
    event.handler = noteInput.handler;
  }
  if (noteInput.reviewDueAt) {
    event.reviewDueAt = noteInput.reviewDueAt;
  }
  if (noteInput.severity) {
    event.severity = noteInput.severity;
  }
  if (event.status === EVENT_STATUS.ASSIGNED || event.status === EVENT_STATUS.PENDING) {
    event.status = EVENT_STATUS.IN_PROGRESS;
    if (!event.inProgressAt) event.inProgressAt = now;
  }
  return { ...event, isOverdue: isEventOverdue(event) };
}

export async function closeHealthEvent(db, id, closeInput, options = {}) {
  const event = getHealthEventRef(db, id);
  if (!event) return null;
  if (event.status === EVENT_STATUS.CLOSED) {
    return { error: "already_closed", message: "事件已关闭" };
  }
  if (event.severity === EVENT_SEVERITY.CRITICAL) {
    if (!event.handler && !closeInput?.handler) {
      return {
        error: "critical_handler_required",
        message: "严重事件关闭前必须记录处理人"
      };
    }
    if (!event.reviewDueAt && !closeInput?.reviewDueAt) {
      return {
        error: "critical_review_due_required",
        message: "严重事件关闭前必须记录预计复查时间"
      };
    }
    if (!closeInput?.reason) {
      return {
        error: "critical_close_reason_required",
        message: "严重事件关闭时必须填写关闭原因"
      };
    }
  }
  const now = new Date().toISOString();
  if (closeInput?.handler) event.handler = closeInput.handler;
  if (closeInput?.reviewDueAt) event.reviewDueAt = closeInput.reviewDueAt;
  event.status = EVENT_STATUS.CLOSED;
  event.closedAt = now;
  event.updatedAt = now;
  event.closeReason = closeInput?.reason || "处理完成";
  event.notes.push({
    id: `hn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "close",
    content: closeInput?.reason || "处理完成",
    createdAt: now,
    author: closeInput?.closer || (event.handler || event.assignee || "system"),
    resolution: closeInput?.resolution || null
  });

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.HEALTH_EVENT_CLOSED, {
      healthEventId: event.id,
      animalId: event.animalId,
      closeReason: event.closeReason,
      severity: event.severity,
      handler: event.handler
    }, {
      animalId: event.animalId,
      roomId: event.roomId || null,
      zoneId: event.zoneId || null,
      projectId: event.projectId || null,
      operator: options.operator || null,
      metadata: options.metadata || null
    });
  }

  return { ...event, isOverdue: isEventOverdue(event) };
}

export function getHealthEventStats(db, filters = {}) {
  let events = db.healthEvents ? [...db.healthEvents] : [];
  if (filters.project) events = events.filter((e) => e.project === filters.project);
  if (filters.keeper) events = events.filter((e) => e.keeper === filters.keeper);
  if (filters.handler) events = events.filter((e) => e.handler === filters.handler);
  if (filters.assignee) events = events.filter((e) => e.assignee === filters.assignee);
  if (filters.roomId) events = events.filter((e) => e.roomId === filters.roomId);
  if (filters.severity) events = events.filter((e) => e.severity === filters.severity);
  if (filters.fromDate) events = events.filter((e) => e.createdAt.slice(0, 10) >= filters.fromDate);
  if (filters.toDate) events = events.filter((e) => e.createdAt.slice(0, 10) <= filters.toDate);
  const total = events.length;
  const byStatus = Object.fromEntries(
    Object.values(EVENT_STATUS).map((s) => [s, events.filter((e) => e.status === s).length])
  );
  const bySeverity = Object.fromEntries(
    Object.values(EVENT_SEVERITY).map((s) => [s, events.filter((e) => (e.severity || EVENT_SEVERITY.NORMAL) === s).length])
  );
  const bySource = {};
  let overdueCount = 0;
  const overdueEventIds = [];
  const byProject = {};
  const byKeeper = {};
  const byRoom = {};
  const byKeyword = {};
  let totalProcessingHours = 0;
  let closedCount = 0;
  for (const ev of events) {
    if (ev.project) {
      byProject[ev.project] = (byProject[ev.project] || 0) + 1;
    }
    if (ev.keeper) {
      byKeeper[ev.keeper] = (byKeeper[ev.keeper] || 0) + 1;
    }
    if (ev.roomId) {
      byRoom[ev.roomId] = (byRoom[ev.roomId] || 0) + 1;
    }
    if (ev.source) {
      bySource[ev.source] = (bySource[ev.source] || 0) + 1;
    }
    for (const kw of ev.abnormalKeywords || []) {
      byKeyword[kw] = (byKeyword[kw] || 0) + 1;
    }
    if (isEventOverdue(ev)) {
      overdueCount += 1;
      overdueEventIds.push(ev.id);
    }
    if (ev.status === EVENT_STATUS.CLOSED && ev.closedAt && ev.createdAt) {
      const hours = (new Date(ev.closedAt).getTime() - new Date(ev.createdAt).getTime()) / 36e5;
      totalProcessingHours += hours;
      closedCount += 1;
    }
  }
  const avgProcessingHours = closedCount > 0 ? totalProcessingHours / closedCount : 0;
  const closeRate = total > 0 ? (byStatus[EVENT_STATUS.CLOSED] || 0) / total : 0;
  const topKeywords = Object.entries(byKeyword)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));
  return {
    total,
    byStatus,
    byStatusLabels: EVENT_STATUS_LABELS,
    bySeverity,
    bySeverityLabels: EVENT_SEVERITY_LABELS,
    bySource,
    byProject,
    byKeeper,
    byRoom,
    topKeywords,
    avgProcessingHours: Number(avgProcessingHours.toFixed(2)),
    closeRate: Number((closeRate * 100).toFixed(2)),
    closedCount,
    overdueCount,
    overdueEventIds,
    filtersApplied: filters
  };
}

const HISTORICAL_SOURCES = [
  "historical_note",
  "historical_quarantine",
  "historical_quarantine_abnormal",
  "historical_abnormal_mark"
];

export async function migrateHistoricalNotes(db, options = {}) {
  ensureHealthCollections(db);
  const existingSourceIds = new Set();
  for (const e of db.healthEvents) {
    if (e.sourceRecordId) existingSourceIds.add(e.sourceRecordId);
    if (e.relatedRecordIds && e.relatedRecordIds.length) {
      for (const rid of e.relatedRecordIds) {
        existingSourceIds.add(rid);
      }
    }
  }
  let createdCount = 0;
  let mergedCount = 0;
  const animals = db.animals || [];
  for (const animal of animals) {
    if (animal.notes && animal.notes.length) {
      for (const note of animal.notes) {
        if (existingSourceIds.has(note.id)) continue;
        const result = await detectAndCreateEvent(db, {
          animalId: animal.id,
          condition: note.condition || "",
          weight: note.weight,
          source: "historical_note",
          sourceRecordId: note.id,
          keeper: note.keeper || animal.keeper
        }, { ...options, skipEvent: true });
        if (result.created) {
          if (result.merged) mergedCount += 1;
          else createdCount += 1;
        }
      }
    }
    if (animal.quarantineRecords && animal.quarantineRecords.length) {
      for (const qr of animal.quarantineRecords) {
        if (existingSourceIds.has(qr.id)) continue;
        if (!qr.isAbnormal && !qr.condition && !qr.symptoms?.length) continue;
        const conditionText = [qr.condition || "", ...(qr.symptoms || []), qr.notes || ""].join(" ");
        const result = await detectAndCreateEvent(db, {
          animalId: animal.id,
          condition: conditionText,
          weight: qr.weight,
          source: qr.isAbnormal ? "historical_quarantine_abnormal" : "historical_quarantine",
          sourceRecordId: qr.id,
          keeper: qr.examiner || animal.keeper
        }, { ...options, skipEvent: true });
        if (result.created) {
          if (result.merged) mergedCount += 1;
          else createdCount += 1;
        } else if (qr.isAbnormal) {
          const allKeywords = ["检疫标记异常"];
          const existing = findMergeableEvent(db, animal.id, allKeywords);
          const eventParams = {
            animalId: animal.id,
            condition: conditionText || "检疫记录标记异常",
            abnormalKeywords: allKeywords,
            weightChange: qr.weight ? calculateWeightChange(animal, qr.weight) : null,
            source: "historical_quarantine_abnormal",
            sourceRecordId: qr.id,
            keeper: qr.examiner || animal.keeper
          };
          if (existing) {
            mergeToExistingEvent(db, existing, eventParams);
            mergedCount += 1;
          } else {
            await createHealthEvent(db, eventParams, { ...options, skipEvent: true });
            createdCount += 1;
          }
        }
      }
    }
    if (animal.status === "quarantine_abnormal" && animal.abnormalReason) {
      const markerId = `abnormal-mark-${animal.id}`;
      if (!existingSourceIds.has(markerId)) {
        const existing = findMergeableEvent(db, animal.id, ["检疫标记异常"]);
        const eventParams = {
          animalId: animal.id,
          condition: animal.abnormalReason + (animal.abnormalNotes ? `：${animal.abnormalNotes}` : ""),
          abnormalKeywords: ["检疫标记异常", ...detectAbnormalKeywords(animal.abnormalReason + " " + (animal.abnormalNotes || ""))],
          source: "historical_abnormal_mark",
          sourceRecordId: markerId,
          keeper: animal.abnormalHandler || animal.keeper
        };
        if (existing) {
          mergeToExistingEvent(db, existing, eventParams);
          mergedCount += 1;
        } else {
          await createHealthEvent(db, eventParams, { ...options, skipEvent: true });
          createdCount += 1;
        }
      }
    }
  }
  return { createdCount, mergedCount, total: db.healthEvents.length };
}
