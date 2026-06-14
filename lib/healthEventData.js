import { getAnimal } from "./animalData.js";

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
  if (filters.animalId) events = events.filter((e) => e.animalId === filters.animalId);
  if (filters.source) events = events.filter((e) => e.source === filters.source);
  if (filters.fromDate) events = events.filter((e) => e.createdAt.slice(0, 10) >= filters.fromDate);
  if (filters.toDate) events = events.filter((e) => e.createdAt.slice(0, 10) <= filters.toDate);
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getHealthEvent(db, id) {
  if (!db.healthEvents) return null;
  return db.healthEvents.find((e) => e.id === id) || null;
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

export function createHealthEvent(db, params) {
  ensureHealthCollections(db);
  const animal = getAnimal(db, params.animalId);
  const event = {
    id: params.id || `hev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    animalId: params.animalId,
    project: animal ? animal.project : params.project || null,
    keeper: animal ? animal.keeper : params.keeper || null,
    source: params.source || "manual",
    sourceRecordId: params.sourceRecordId || null,
    condition: params.condition || "",
    abnormalKeywords: params.abnormalKeywords || [],
    weightChange: params.weightChange || null,
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
    relatedRecordIds: params.sourceRecordId ? [params.sourceRecordId] : []
  };
  if (params.assignee) {
    event.status = EVENT_STATUS.ASSIGNED;
    event.assignedAt = event.createdAt;
  }
  db.healthEvents.push(event);
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

export function detectAndCreateEvent(db, params) {
  const { animalId, condition, weight, source, sourceRecordId, keeper } = params;
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
  const eventParams = {
    animalId,
    condition: fullCondition,
    abnormalKeywords: allKeywords,
    weightChange: weightResult,
    source: source || "feeding_checkin",
    sourceRecordId,
    keeper
  };
  if (existing) {
    const merged = mergeToExistingEvent(db, existing, eventParams);
    return { created: true, merged: true, event: merged };
  }
  const event = createHealthEvent(db, eventParams);
  return { created: true, merged: false, event };
}

export function assignHealthEvent(db, id, assignee) {
  const event = getHealthEvent(db, id);
  if (!event) return null;
  if (event.status === EVENT_STATUS.CLOSED) {
    return { error: "event_closed", message: "已关闭事件无法分派" };
  }
  const now = new Date().toISOString();
  event.assignee = assignee;
  event.updatedAt = now;
  if (event.status === EVENT_STATUS.PENDING) {
    event.status = EVENT_STATUS.ASSIGNED;
    event.assignedAt = now;
  }
  event.notes.push({
    id: `hn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "assign",
    content: `分派负责人：${assignee}`,
    createdAt: now,
    author: "system"
  });
  return event;
}

export function addEventNote(db, id, noteInput) {
  const event = getHealthEvent(db, id);
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
  if (event.status === EVENT_STATUS.ASSIGNED || event.status === EVENT_STATUS.PENDING) {
    event.status = EVENT_STATUS.IN_PROGRESS;
    if (!event.inProgressAt) event.inProgressAt = now;
  }
  return event;
}

export function closeHealthEvent(db, id, closeInput) {
  const event = getHealthEvent(db, id);
  if (!event) return null;
  if (event.status === EVENT_STATUS.CLOSED) {
    return { error: "already_closed", message: "事件已关闭" };
  }
  const now = new Date().toISOString();
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
  return event;
}

export function getHealthEventStats(db, filters = {}) {
  let events = db.healthEvents ? [...db.healthEvents] : [];
  if (filters.project) events = events.filter((e) => e.project === filters.project);
  if (filters.keeper) events = events.filter((e) => e.keeper === filters.keeper);
  if (filters.handler) events = events.filter((e) => e.handler === filters.handler);
  if (filters.assignee) events = events.filter((e) => e.assignee === filters.assignee);
  if (filters.fromDate) events = events.filter((e) => e.createdAt.slice(0, 10) >= filters.fromDate);
  if (filters.toDate) events = events.filter((e) => e.createdAt.slice(0, 10) <= filters.toDate);
  const total = events.length;
  const byStatus = Object.fromEntries(
    Object.values(EVENT_STATUS).map((s) => [s, events.filter((e) => e.status === s).length])
  );
  const byProject = {};
  const byKeeper = {};
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
    for (const kw of ev.abnormalKeywords || []) {
      byKeyword[kw] = (byKeyword[kw] || 0) + 1;
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
    byProject,
    byKeeper,
    topKeywords,
    avgProcessingHours: Number(avgProcessingHours.toFixed(2)),
    closeRate: Number((closeRate * 100).toFixed(2)),
    closedCount,
    filtersApplied: filters
  };
}

const HISTORICAL_SOURCES = [
  "historical_note",
  "historical_quarantine",
  "historical_quarantine_abnormal",
  "historical_abnormal_mark"
];

export function migrateHistoricalNotes(db) {
  ensureHealthCollections(db);
  const existingSourceIds = new Set();
  for (const e of db.healthEvents) {
    if (!HISTORICAL_SOURCES.includes(e.source)) continue;
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
        const result = detectAndCreateEvent(db, {
          animalId: animal.id,
          condition: note.condition || "",
          weight: note.weight,
          source: "historical_note",
          sourceRecordId: note.id,
          keeper: note.keeper || animal.keeper
        });
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
        const result = detectAndCreateEvent(db, {
          animalId: animal.id,
          condition: conditionText,
          weight: qr.weight,
          source: qr.isAbnormal ? "historical_quarantine_abnormal" : "historical_quarantine",
          sourceRecordId: qr.id,
          keeper: qr.examiner || animal.keeper
        });
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
            createHealthEvent(db, eventParams);
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
          createHealthEvent(db, eventParams);
          createdCount += 1;
        }
      }
    }
  }
  return { createdCount, mergedCount, total: db.healthEvents.length };
}
