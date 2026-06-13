import { localDate } from "./helpers.js";
import { ensureFeedingCollections, listFeedingPlans, listFeedingRecords } from "./feedingData.js";

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
