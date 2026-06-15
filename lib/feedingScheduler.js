import { localDate } from "./helpers.js";
import { ensureFeedingCollections, listFeedingPlans, listFeedingRecords } from "./feedingData.js";
import { ROLES } from "./apiKeys.js";

export function isPlanActiveOnDate(plan, dateStr) {
  if (plan.status !== "active") return false;
  if (plan.startDate && dateStr < plan.startDate) return false;
  if (plan.endDate && dateStr > plan.endDate) return false;
  return true;
}

export function getTodayTasks(db, options = {}) {
  ensureFeedingCollections(db);
  const date = options.date || localDate();
  const targetType = options.targetType || null;
  const keeper = options.keeper || null;

  const activePlans = listFeedingPlans(db, { status: "active" }).filter((plan) =>
    isPlanActiveOnDate(plan, date)
  );

  const todayRecords = listFeedingRecords(db, { date });
  const completedKeys = new Set(
    todayRecords
      .filter((r) => r.status === "completed")
      .map((r) => `${r.planId}_${r.scheduledTime || ""}`)
  );

  const tasks = [];
  for (const plan of activePlans) {
    if (targetType && plan.targetType !== targetType) continue;
    if (keeper && plan.keeper !== keeper) continue;

    const times = plan.feedTimes && plan.feedTimes.length > 0 ? plan.feedTimes : [""];
    for (const time of times) {
      const key = `${plan.id}_${time}`;
      const isCompleted = completedKeys.has(key);
      const record = todayRecords.find(
        (r) => r.planId === plan.id && r.scheduledTime === time && r.status === "completed"
      );

      tasks.push({
        planId: plan.id,
        targetType: plan.targetType,
        targetId: plan.targetId,
        feedType: plan.feedType,
        scheduledTime: time || null,
        keeper: plan.keeper,
        status: isCompleted ? "completed" : "pending",
        completedAt: record ? record.actualTime : null,
        recordId: record ? record.id : null,
        date
      });
    }
  }

  return tasks.sort((a, b) => {
    const ta = a.scheduledTime || "99:99";
    const tb = b.scheduledTime || "99:99";
    return ta.localeCompare(tb);
  });
}

export function getFeedingHistory(db, options = {}) {
  ensureFeedingCollections(db);
  const days = options.days || 7;
  const targetType = options.targetType || null;
  const targetId = options.targetId || null;
  const keeper = options.keeper || null;

  const today = new Date();
  const dateList = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dateList.push(localDate(d));
  }

  const plans = listFeedingPlans(db, targetType ? { targetType } : {});
  const filteredPlans = plans.filter((p) => {
    if (targetId && p.targetId !== targetId) return false;
    if (keeper && p.keeper !== keeper) return false;
    return true;
  });

  const records = listFeedingRecords(db, keeper ? { keeper } : {}).filter((r) => {
    if (targetType && r.targetType !== targetType) return false;
    if (targetId && r.targetId !== targetId) return false;
    return dateList.includes(r.date);
  });

  const dailyStats = dateList.map((date) => {
    const dayRecords = records.filter((r) => r.date === date);
    const dayPlans = filteredPlans.filter((p) => isPlanActiveOnDate(p, date));
    let totalTasks = 0;
    for (const plan of dayPlans) {
      totalTasks += plan.feedTimes && plan.feedTimes.length > 0 ? plan.feedTimes.length : 1;
    }
    const completed = dayRecords.filter((r) => r.status === "completed").length;

    return {
      date,
      totalTasks,
      completed,
      completionRate: totalTasks > 0 ? Number(((completed / totalTasks) * 100).toFixed(1)) : 0,
      records: dayRecords
    };
  });

  const totalCompleted = dailyStats.reduce((sum, d) => sum + d.completed, 0);
  const totalTasks = dailyStats.reduce((sum, d) => sum + d.totalTasks, 0);

  return {
    days,
    totalCompleted,
    totalTasks,
    overallCompletionRate: totalTasks > 0 ? Number(((totalCompleted / totalTasks) * 100).toFixed(1)) : 0,
    dailyStats
  };
}

export function getTodaySummary(db, options = {}) {
  const tasks = getTodayTasks(db, options);
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const pending = total - completed;

  return {
    date: options.date || localDate(),
    total,
    completed,
    pending,
    completionRate: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0,
    byKeeper: groupByKeeper(tasks)
  };
}

function groupByKeeper(tasks) {
  const map = new Map();
  for (const task of tasks) {
    const k = task.keeper || "未分配";
    if (!map.has(k)) {
      map.set(k, { keeper: k, total: 0, completed: 0 });
    }
    const stat = map.get(k);
    stat.total++;
    if (task.status === "completed") stat.completed++;
  }
  return Array.from(map.values()).map((s) => ({
    ...s,
    completionRate: s.total > 0 ? Number(((s.completed / s.total) * 100).toFixed(1)) : 0
  }));
}

function parseDate(dateStr) {
  const parts = dateStr.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function generateDateRange(dateFrom, dateTo) {
  const dates = [];
  const start = parseDate(dateFrom);
  const end = parseDate(dateTo);
  const d = new Date(start);
  while (d <= end) {
    dates.push(localDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export function getDefaultDateRange() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  return {
    dateFrom: localDate(today),
    dateTo: localDate(end)
  };
}

export function validateDateRange(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) {
    return { valid: false, error: "date_from_and_to_required", message: "dateFrom 和 dateTo 均为必填" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return { valid: false, error: "invalid_date_format", message: "日期格式必须为 YYYY-MM-DD" };
  }
  const start = parseDate(dateFrom);
  const end = parseDate(dateTo);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: "invalid_date", message: "无效的日期" };
  }
  if (localDate(start) !== dateFrom || localDate(end) !== dateTo) {
    return { valid: false, error: "invalid_date", message: "无效的日期（月/日溢出）" };
  }
  if (end < start) {
    return { valid: false, error: "date_to_before_from", message: "dateTo 不能早于 dateFrom" };
  }
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > 31) {
    return { valid: false, error: "range_too_large", message: "查询范围不能超过31天" };
  }
  return { valid: true, days: diffDays };
}

function calculateMissedRisk(tasks, dateStr, nowIso) {
  const today = localDate();
  const isPastOrToday = dateStr <= today;

  const pending = tasks.filter((t) => t.status === "pending");
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;

  if (total === 0) {
    return { level: "none", reason: "no_tasks", pendingCount: 0, overdueCount: 0 };
  }

  let overdueCount = 0;
  if (isPastOrToday) {
    for (const task of pending) {
      if (!task.scheduledTime) {
        if (dateStr < today) overdueCount++;
        continue;
      }
      const scheduledIso = `${dateStr}T${task.scheduledTime}:00`;
      if (new Date(scheduledIso).getTime() < Date.now()) {
        overdueCount++;
      }
    }
  }

  let level = "low";
  let reason = "on_schedule";

  if (dateStr < today) {
    if (pending.length > 0) {
      level = pending.length === total ? "critical" : "high";
      reason = "past_date_incomplete";
    } else {
      level = "none";
      reason = "all_completed";
    }
  } else if (dateStr === today) {
    if (overdueCount > 0) {
      const overdueRatio = overdueCount / total;
      level = overdueRatio >= 0.5 ? "high" : "medium";
      reason = "overdue_tasks";
    } else if (pending.length === 0) {
      level = "none";
      reason = "all_completed";
    } else {
      level = "low";
      reason = "pending_on_time";
    }
  } else {
    const completionRate = completed / total;
    if (completionRate === 0) {
      level = "low";
      reason = "future_no_action";
    } else if (completionRate < 0.3) {
      level = "low";
      reason = "future_early_progress";
    } else {
      level = "low";
      reason = "future_in_progress";
    }
  }

  return {
    level,
    reason,
    pendingCount: pending.length,
    overdueCount
  };
}

export function getFeedingSchedule(db, options = {}) {
  ensureFeedingCollections(db);

  let { dateFrom, dateTo } = options;
  const defaults = getDefaultDateRange();
  if (!dateFrom) dateFrom = defaults.dateFrom;
  if (!dateTo) dateTo = defaults.dateTo;

  const validation = validateDateRange(dateFrom, dateTo);
  if (!validation.valid) {
    return { error: validation.error, message: validation.message };
  }

  const targetType = options.targetType || null;
  const keeper = options.keeper || null;
  const roomId = options.roomId || null;
  const principal = options.principal || null;

  const dateList = generateDateRange(dateFrom, dateTo);
  const nowIso = new Date().toISOString();

  let activePlans = listFeedingPlans(db, { status: "active" });
  if (targetType) activePlans = activePlans.filter((p) => p.targetType === targetType);
  if (keeper) activePlans = activePlans.filter((p) => p.keeper === keeper);
  if (roomId) activePlans = activePlans.filter((p) => p.roomId === roomId);

  if (principal && principal.role !== ROLES.ADMIN) {
    const allowedRoomIds = principal.allowedRoomIds || ["*"];
    if (!allowedRoomIds.includes("*")) {
      activePlans = activePlans.filter((p) => allowedRoomIds.includes(p.roomId));
    }
  }

  const allRecords = listFeedingRecords(db).filter((r) => {
    if (targetType && r.targetType !== targetType) return false;
    if (keeper && r.keeper !== keeper) return false;
    if (roomId && r.roomId !== roomId) return false;
    return dateList.includes(r.date);
  });

  if (principal && principal.role !== ROLES.ADMIN) {
    const allowedRoomIds = principal.allowedRoomIds || ["*"];
    if (!allowedRoomIds.includes("*")) {
      const filtered = [];
      for (const r of allRecords) {
        if (allowedRoomIds.includes(r.roomId) || !r.roomId) filtered.push(r);
      }
      allRecords.length = 0;
      allRecords.push(...filtered);
    }
  }

  const dailySchedule = [];
  let overallTotal = 0;
  let overallCompleted = 0;
  let overallPending = 0;
  let overallOverdue = 0;
  const overallByKeeper = new Map();

  for (const date of dateList) {
    const dayPlans = activePlans.filter((p) => isPlanActiveOnDate(p, date));
    const dayRecords = allRecords.filter((r) => r.date === date);
    const completedKeys = new Set(
      dayRecords
        .filter((r) => r.status === "completed")
        .map((r) => `${r.planId}_${r.scheduledTime || ""}`)
    );

    const tasks = [];
    for (const plan of dayPlans) {
      const times = plan.feedTimes && plan.feedTimes.length > 0 ? plan.feedTimes : [""];
      for (const time of times) {
        const key = `${plan.id}_${time}`;
        const isCompleted = completedKeys.has(key);
        const record = dayRecords.find(
          (r) => r.planId === plan.id && r.scheduledTime === time && r.status === "completed"
        );
        tasks.push({
          planId: plan.id,
          targetType: plan.targetType,
          targetId: plan.targetId,
          feedType: plan.feedType,
          scheduledTime: time || null,
          keeper: plan.keeper,
          status: isCompleted ? "completed" : "pending",
          completedAt: record ? record.actualTime : null,
          recordId: record ? record.id : null,
          roomId: plan.roomId,
          zoneId: plan.zoneId || null,
          date
        });
      }
    }

    tasks.sort((a, b) => {
      const ta = a.scheduledTime || "99:99";
      const tb = b.scheduledTime || "99:99";
      return ta.localeCompare(tb);
    });

    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const pending = total - completed;
    const missedRisk = calculateMissedRisk(tasks, date, nowIso);

    const byKeeper = groupByKeeper(tasks);
    for (const k of byKeeper) {
      if (!overallByKeeper.has(k.keeper)) {
        overallByKeeper.set(k.keeper, { keeper: k.keeper, total: 0, completed: 0 });
      }
      const agg = overallByKeeper.get(k.keeper);
      agg.total += k.total;
      agg.completed += k.completed;
    }

    overallTotal += total;
    overallCompleted += completed;
    overallPending += pending;
    overallOverdue += missedRisk.overdueCount;

    dailySchedule.push({
      date,
      total,
      completed,
      pending,
      completionRate: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0,
      missedRisk,
      byKeeper,
      tasks
    });
  }

  const overallByKeeperArr = Array.from(overallByKeeper.values()).map((s) => ({
    ...s,
    completionRate: s.total > 0 ? Number(((s.completed / s.total) * 100).toFixed(1)) : 0
  }));

  return {
    dateFrom,
    dateTo,
    days: dateList.length,
    filters: {
      targetType: targetType || null,
      keeper: keeper || null,
      roomId: roomId || null
    },
    overall: {
      total: overallTotal,
      completed: overallCompleted,
      pending: overallPending,
      overdue: overallOverdue,
      completionRate: overallTotal > 0 ? Number(((overallCompleted / overallTotal) * 100).toFixed(1)) : 0,
      byKeeper: overallByKeeperArr
    },
    dailySchedule
  };
}
