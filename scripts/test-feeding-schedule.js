import { readFile, unlink, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_VERIFY_MODE = process.env.VERIFY_MODE === "1";
const dbPath = process.env.DB_PATH || join(__dirname, "..", "data", "lab.json");
const dbBackupPath = join(__dirname, "..", "data", "lab.json.schedule-test-backup");

import {
  getTodayTasks,
  getTodaySummary,
  getFeedingSchedule,
  validateDateRange,
  getDefaultDateRange
} from "../lib/feedingScheduler.js";

import { listFeedingPlans, addFeedingPlan } from "../lib/feedingData.js";

import { localDate, saveDb } from "../lib/helpers.js";

let testDbBackup = null;

async function loadDb() {
  return JSON.parse(await readFile(dbPath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTest(name, testFn) {
  console.log(`\n=== ${name} ===`);
  try {
    await testFn();
    console.log(`✅ ${name} - PASSED`);
    return true;
  } catch (error) {
    console.log(`❌ ${name} - FAILED: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

async function backupData() {
  testDbBackup = JSON.parse(await readFile(dbPath, "utf8"));
  if (existsSync(dbPath)) {
    await copyFile(dbPath, dbBackupPath);
  }
}

async function restoreData() {
  if (existsSync(dbBackupPath)) {
    await copyFile(dbBackupPath, dbPath);
    await unlink(dbBackupPath);
  }
}

function dateOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localDate(d);
}

const passed = [];
const failed = [];

async function main() {
  console.log("┌─────────────────────────────────────────────┐");
  console.log("│  饲喂日程 Schedule 接口验证测试脚本          │");
  console.log("└─────────────────────────────────────────────┘");

  if (!IS_VERIFY_MODE) {
    await backupData();
  }

  try {
    const db = await loadDb();

    const t1 = await runTest("1. 日期范围验证 validateDateRange", async () => {
      let r = validateDateRange("2026-06-15", "2026-06-21");
      assert(r.valid === true && r.days === 7, "7天范围验证通过");

      r = validateDateRange("2026-06-15", "2026-06-15");
      assert(r.valid === true && r.days === 1, "单日范围验证通过");

      r = validateDateRange("2026-06-21", "2026-06-15");
      assert(r.valid === false && r.error === "date_to_before_from", "dateTo早于dateFrom返回错误");

      r = validateDateRange("2026-06-15", "2026-07-20");
      assert(r.valid === false && r.error === "range_too_large", "超过31天范围返回错误");

      r = validateDateRange("invalid", "2026-06-21");
      assert(r.valid === false && r.error === "invalid_date_format", "非法格式返回错误");

      r = validateDateRange("", "");
      assert(r.valid === false, "空字符串返回错误");
    });
    t1 ? passed.push(1) : failed.push(1);

    const t2 = await runTest("2. 默认日期范围 getDefaultDateRange", async () => {
      const range = getDefaultDateRange();
      assert(!!range.dateFrom, "返回dateFrom");
      assert(!!range.dateTo, "返回dateTo");
      const r = validateDateRange(range.dateFrom, range.dateTo);
      assert(r.valid === true && r.days === 7, "默认范围为7天");
    });
    t2 ? passed.push(2) : failed.push(2);

    const t3 = await runTest("3. 默认7天日程查询 getFeedingSchedule (无参数)", async () => {
      const result = getFeedingSchedule(db, {});
      assert(!result.error, "无错误返回");
      assert(result.days === 7, "返回7天数据");
      assert(Array.isArray(result.dailySchedule), "dailySchedule是数组");
      assert(result.dailySchedule.length === 7, "dailySchedule包含7个元素");
      assert(result.overall && typeof result.overall.total === "number", "overall统计存在");
      assert(result.filters, "filters对象存在");

      for (const day of result.dailySchedule) {
        assert(typeof day.date === "string", `${day.date} 日期字段存在`);
        assert(typeof day.total === "number", `${day.date} total字段存在`);
        assert(typeof day.completed === "number", `${day.date} completed字段存在`);
        assert(typeof day.pending === "number", `${day.date} pending字段存在`);
        assert(day.completionRate >= 0 && day.completionRate <= 100, `${day.date} completionRate合法`);
        assert(day.missedRisk, `${day.date} missedRisk存在`);
        assert(["none", "low", "medium", "high", "critical"].includes(day.missedRisk.level),
          `${day.date} missedRisk.level合法: ${day.missedRisk.level}`);
        assert(Array.isArray(day.tasks), `${day.date} tasks数组存在`);
        assert(Array.isArray(day.byKeeper), `${day.date} byKeeper数组存在`);
      }
    });
    t3 ? passed.push(3) : failed.push(3);

    const t4 = await runTest("4. 自定义日期范围查询", async () => {
      const from = dateOffset(0);
      const to = dateOffset(3);
      const result = getFeedingSchedule(db, { dateFrom: from, dateTo: to });
      assert(!result.error, "无错误返回");
      assert(result.dateFrom === from, `dateFrom匹配: ${from}`);
      assert(result.dateTo === to, `dateTo匹配: ${to}`);
      assert(result.days === 4, `返回4天数据，实际: ${result.days}`);
    });
    t4 ? passed.push(4) : failed.push(4);

    const t5 = await runTest("5. 按targetType筛选 (animal)", async () => {
      const result = getFeedingSchedule(db, {
        dateFrom: dateOffset(0),
        dateTo: dateOffset(2),
        targetType: "animal"
      });
      assert(result.filters.targetType === "animal", "filters.targetType正确");
      for (const day of result.dailySchedule) {
        for (const task of day.tasks) {
          assert(task.targetType === "animal",
            `任务${task.planId} targetType为animal，实际: ${task.targetType}`);
        }
      }
    });
    t5 ? passed.push(5) : failed.push(5);

    const t6 = await runTest("6. 按targetType筛选 (cage)", async () => {
      const result = getFeedingSchedule(db, {
        dateFrom: dateOffset(0),
        dateTo: dateOffset(2),
        targetType: "cage"
      });
      for (const day of result.dailySchedule) {
        for (const task of day.tasks) {
          assert(task.targetType === "cage",
            `任务${task.planId} targetType为cage，实际: ${task.targetType}`);
        }
      }
    });
    t6 ? passed.push(6) : failed.push(6);

    const t7 = await runTest("7. 按keeper筛选", async () => {
      const result = getFeedingSchedule(db, {
        dateFrom: dateOffset(0),
        dateTo: dateOffset(2),
        keeper: "林青"
      });
      assert(result.filters.keeper === "林青", "filters.keeper正确");
      for (const day of result.dailySchedule) {
        for (const task of day.tasks) {
          assert(task.keeper === "林青",
            `任务keeper为林青，实际: ${task.keeper}`);
        }
      }
    });
    t7 ? passed.push(7) : failed.push(7);

    const t8 = await runTest("8. 按roomId筛选", async () => {
      const activePlans = listFeedingPlans(db, { status: "active" });
      const rooms = [...new Set(activePlans.map(p => p.roomId).filter(Boolean))];
      if (rooms.length > 0) {
        const targetRoom = rooms[0];
        const result = getFeedingSchedule(db, {
          dateFrom: dateOffset(0),
          dateTo: dateOffset(2),
          roomId: targetRoom
        });
        assert(result.filters.roomId === targetRoom, "filters.roomId正确");
        for (const day of result.dailySchedule) {
          for (const task of day.tasks) {
            assert(task.roomId === targetRoom,
              `任务roomId正确，实际: ${task.roomId}`);
          }
        }
      } else {
        console.log("  ⚠ 跳过：无可用roomId数据");
      }
    });
    t8 ? passed.push(8) : failed.push(8);

    const t9 = await runTest("9. 任务复用getTodayTasks生成逻辑 - 数据一致性验证", async () => {
      const today = localDate();
      const todayTasksFromSchedule = getFeedingSchedule(db, {
        dateFrom: today,
        dateTo: today
      });
      const scheduleTaskList = todayTasksFromSchedule.dailySchedule[0].tasks;

      const directTasks = getTodayTasks(db, { date: today });

      assert(
        scheduleTaskList.length === directTasks.length,
        `schedule返回的今日任务数与getTodayTasks一致: ${scheduleTaskList.length} vs ${directTasks.length}`
      );

      const scheduleKeys = new Set(scheduleTaskList.map(t => `${t.planId}_${t.scheduledTime}`));
      const directKeys = new Set(directTasks.map(t => `${t.planId}_${t.scheduledTime}`));

      for (const k of scheduleKeys) {
        assert(directKeys.has(k), `任务键一致: ${k}`);
      }

      for (let i = 0; i < directTasks.length; i++) {
        const direct = directTasks[i];
        const sched = scheduleTaskList.find(t =>
          t.planId === direct.planId && t.scheduledTime === direct.scheduledTime
        );
        assert(sched, `找到对应任务: ${direct.planId}`);
        assert(sched.status === direct.status, `${direct.planId} status一致`);
        assert(sched.recordId === direct.recordId, `${direct.planId} recordId一致`);
      }
    });
    t9 ? passed.push(9) : failed.push(9);

    const t10 = await runTest("10. 今日统计与schedule内聚合一致性", async () => {
      const today = localDate();
      const summary = getTodaySummary(db, { date: today });
      const schedule = getFeedingSchedule(db, { dateFrom: today, dateTo: today });
      const day = schedule.dailySchedule[0];

      assert(summary.total === day.total, `total一致: ${summary.total} vs ${day.total}`);
      assert(summary.completed === day.completed, `completed一致`);
      assert(summary.pending === day.pending, `pending一致`);
      assert(Math.abs(summary.completionRate - day.completionRate) < 0.2,
        `completionRate相近: ${summary.completionRate} vs ${day.completionRate}`);
    });
    t10 ? passed.push(10) : failed.push(10);

    const t11 = await runTest("11. 非法日期范围返回错误结构", async () => {
      const result = getFeedingSchedule(db, {
        dateFrom: "2026-13-01",
        dateTo: "2026-13-05"
      });
      assert(!!result.error, "返回error字段");
      assert(!!result.message, "返回message字段");
    });
    t11 ? passed.push(11) : failed.push(11);

    const t12 = await runTest("12. 非管理员权限过滤 (模拟principal)", async () => {
      const principal = {
        role: "keeper",
        allowedRoomIds: ["room-secondary"]
      };
      const unrestricted = getFeedingSchedule(db, {
        dateFrom: dateOffset(0),
        dateTo: dateOffset(2)
      });
      const restricted = getFeedingSchedule(db, {
        dateFrom: dateOffset(0),
        dateTo: dateOffset(2),
        principal
      });

      for (const day of restricted.dailySchedule) {
        for (const task of day.tasks) {
          assert(
            task.roomId === "room-secondary" || !task.roomId,
            `权限过滤后roomId合法: ${task.roomId}`
          );
        }
      }

      const unrestrictedTotal = unrestricted.overall.total;
      const restrictedTotal = restricted.overall.total;
      assert(
        restrictedTotal <= unrestrictedTotal,
        `权限过滤后任务数不增加: ${restrictedTotal} <= ${unrestrictedTotal}`
      );
    });
    t12 ? passed.push(12) : failed.push(12);

    const t13 = await runTest("13. 新增饲喂计划后schedule能正确反映", async () => {
      const today = localDate();
      const before = getFeedingSchedule(db, { dateFrom: today, dateTo: today });
      const beforeCount = before.dailySchedule[0].total;

      const planStart = dateOffset(0);
      const planEnd = dateOffset(5);
      addFeedingPlan(db, {
        targetType: "animal",
        targetId: "ani-1001",
        feedType: "测试补充饲料",
        feedTimes: ["12:00"],
        dailyAmount: 2.0,
        keeper: "林青",
        startDate: planStart,
        endDate: planEnd,
        notes: "测试计划 - 验证schedule"
      });

      const after = getFeedingSchedule(db, {
        dateFrom: planStart,
        dateTo: planEnd
      });

      for (let i = 0; i < after.dailySchedule.length; i++) {
        const day = after.dailySchedule[i];
        const hasExtraTask = day.tasks.some(t =>
          t.feedType === "测试补充饲料" && t.scheduledTime === "12:00"
        );
        assert(hasExtraTask, `第${i + 1}天(${day.date})包含新计划任务`);
      }
    });
    t13 ? passed.push(13) : failed.push(13);

    const t14 = await runTest("14. overall聚合统计正确性", async () => {
      const result = getFeedingSchedule(db, {
        dateFrom: dateOffset(0),
        dateTo: dateOffset(3)
      });
      let sumTotal = 0, sumCompleted = 0, sumPending = 0, sumOverdue = 0;
      for (const d of result.dailySchedule) {
        sumTotal += d.total;
        sumCompleted += d.completed;
        sumPending += d.pending;
        sumOverdue += d.missedRisk.overdueCount;
      }
      assert(sumTotal === result.overall.total, `overall.total与日累计一致: ${sumTotal}`);
      assert(sumCompleted === result.overall.completed, `overall.completed与日累计一致`);
      assert(sumPending === result.overall.pending, `overall.pending与日累计一致`);
      assert(sumOverdue === result.overall.overdue, `overall.overdue与日累计一致`);
    });
    t14 ? passed.push(14) : failed.push(14);

    const t15 = await runTest("15. 任务包含roomId和zoneId信息", async () => {
      const result = getFeedingSchedule(db, {
        dateFrom: dateOffset(0),
        dateTo: dateOffset(1)
      });
      const tasksWithRoom = result.dailySchedule.flatMap(d => d.tasks);
      if (tasksWithRoom.length > 0) {
        for (const t of tasksWithRoom) {
          assert("roomId" in t, `任务${t.planId}包含roomId字段`);
          assert("zoneId" in t, `任务${t.planId}包含zoneId字段`);
          assert("date" in t, `任务${t.planId}包含date字段`);
        }
      } else {
        console.log("  ⚠ 无任务数据，跳过");
      }
    });
    t15 ? passed.push(15) : failed.push(15);

  } catch (err) {
    console.error("\n测试执行异常:", err.message);
    console.error(err.stack);
  } finally {
    if (!IS_VERIFY_MODE) {
      await restoreData();
    }
  }

  console.log("\n┌─────────────────────────────────────────────┐");
  console.log("│  测试总结                                    │");
  console.log("├─────────────────────────────────────────────┤");
  console.log(`│  通过: ${passed.length} 项                                   │`);
  console.log(`│  失败: ${failed.length} 项                                   │`);
  console.log("└─────────────────────────────────────────────┘");

  if (failed.length > 0) {
    console.log("\n失败项编号:", failed.join(", "));
    process.exit(1);
  } else {
    console.log("\n🎉 全部测试通过！");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
