import http from "node:http";
import { spawn } from "node:child_process";
import { unlinkSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IS_VERIFY_MODE = process.env.VERIFY_MODE === "1";
const PORT = IS_VERIFY_MODE
  ? parseInt(new URL(process.env.VERIFY_BASE_URL).port, 10)
  : 3098;
const BASE = process.env.VERIFY_BASE_URL || `http://localhost:${PORT}`;

const TEST_ID = randomUUID().slice(0, 8);
const TMP_DIR = IS_VERIFY_MODE
  ? process.env.VERIFY_TMP_DIR
  : join(ROOT, "tmp", `test-conflict-${TEST_ID}`);
const DB_PATH = join(TMP_DIR, "lab.json");
const EVENT_LEDGER_PATH = join(TMP_DIR, "event-ledger.json");
const AUDIT_LOG_PATH = join(TMP_DIR, "audit-logs.json");

const KEYS = {
  ADMIN: "admin-key-demo-001",
  KEEPER: "keeper-key-demo-001"
};

const TEST_DATE = "2099-06-15";
const TEST_ANIMAL_ID = "ani-1001";

let serverProc = null;
let passed = 0;
let failed = 0;
const results = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function logResult(name, ok, detail = "") {
  if (ok) passed++; else failed++;
  results.push({ name, ok, detail });
  const icon = ok ? "\u2713" : "\u2717";
  const color = ok ? "\x1b[32m" : "\x1b[31m";
  const reset = "\x1b[0m";
  console.log(`${color}${icon}${reset} ${name}${detail ? " — " + detail : ""}`);
}

function request(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : null;
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = http.request(`${BASE}${path}`, { method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : null; }
        catch (e) { parsed = { _raw: data }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function section(title) {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

function subSection(title) {
  console.log("\n" + "-".repeat(70));
  console.log(`  ${title}`);
  console.log("-".repeat(70));
}

function uid(prefix = "test") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn("node", ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        DB_PATH,
        EVENT_LEDGER_PATH,
        AUDIT_LOG_PATH
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderrBuf = "";
    serverProc.stderr.on("data", (d) => (stderrBuf += d.toString()));
    serverProc.stdout.on("data", () => {});
    serverProc.on("exit", (code) => {
      if (code !== 0) reject(new Error(`server exit ${code}: ${stderrBuf}`));
    });

    const start = Date.now();
    const tryConnect = async () => {
      try {
        const r = await request("GET", "/healthz");
        if (r.status === 200) return resolve();
      } catch (e) {}
      if (Date.now() - start > 15000) return reject(new Error("server start timeout"));
      setTimeout(tryConnect, 200);
    };
    tryConnect();
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc) return resolve();
    serverProc.kill("SIGTERM");
    setTimeout(resolve, 300);
  });
}

function cleanupTmpDir() {
  try {
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  } catch (e) {}
}

async function runTests() {
  console.log("=".repeat(70));
  console.log("  离线同步冲突队列 - 回归测试");
  console.log(`  临时目录: ${TMP_DIR}`);
  console.log(`  API Base: ${BASE}`);
  console.log("=".repeat(70));

  try {
    await testMultiDeviceConflictEntersPendingQueue();
    await testAdminResolveServerWins();
    await testAdminResolveClientWins();
    await testKeeperCannotResolveConflict();

    section("测试总结");
    console.log(`\n  通过: ${passed} / ${passed + failed}`);
    console.log(`  失败: ${failed}`);

    if (failed > 0) {
      console.log("\n  失败项:");
      for (const r of results.filter((x) => !x.ok)) {
        console.log(`    \u2717 ${r.name}${r.detail ? " — " + r.detail : ""}`);
      }
      process.exitCode = 1;
    } else {
      console.log("\n\x1b[32m  \u2713 全部通过!\x1b[0m");
    }
  } catch (err) {
    console.error("\n运行错误:", err.message);
    console.error(err.stack);
    process.exitCode = 1;
  }
}

async function testMultiDeviceConflictEntersPendingQueue() {
  section("测试1: 同一动物同一天多端提交 → 进入待处理队列");

  const opIdA = uid("device-a");
  const opIdB = uid("device-b");

  subSection("1.1 设备A提交第一条记录（无冲突，正常写入）");
  const resA = await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opIdA,
          operationType: "animal_note",
          keeper: "林青",
          deviceId: "device-A",
          clientCreatedAt: `${TEST_DATE}T07:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: TEST_ANIMAL_ID,
            date: TEST_DATE,
            weight: 20.0,
            condition: "设备A记录 - 食欲良好"
          }
        }
      ]
    }
  });

  logResult("设备A提交状态码 200", resA.status === 200, `status=${resA.status}`);
  logResult("设备A记录 applied", resA.body.summary?.applied === 1, `applied=${resA.body.summary?.applied}`);
  logResult("设备A返回 note 数据", resA.body.results?.[0]?.data?.note?.id != null,
    `noteId=${resA.body.results?.[0]?.data?.note?.id}`);

  await sleep(100);

  subSection("1.2 设备B提交同动物同天记录（冲突，reject策略）");
  const resB = await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opIdB,
          operationType: "animal_note",
          keeper: "周遥",
          deviceId: "device-B",
          clientCreatedAt: `${TEST_DATE}T08:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: TEST_ANIMAL_ID,
            date: TEST_DATE,
            weight: 21.5,
            condition: "设备B记录 - 体重复测"
          }
        }
      ]
    }
  });

  logResult("设备B提交状态码 409", resB.status === 409, `status=${resB.status}`);
  logResult("设备B检测到 conflicts=1", resB.body.summary?.conflicts === 1,
    `conflicts=${resB.body.summary?.conflicts}`);
  logResult("设备B结果 status=conflict", resB.body.results?.[0]?.status === "conflict",
    `status=${resB.body.results?.[0]?.status}`);
  logResult("设备B返回 conflict_rejected 错误码",
    resB.body.results?.[0]?.error?.code === "conflict_rejected",
    `errorCode=${resB.body.results?.[0]?.error?.code}`);

  await sleep(100);

  subSection("1.3 验证冲突已进入待处理队列");
  const conflictsRes = await request("GET", "/sync/conflicts?status=pending", {
    apiKey: KEYS.ADMIN
  });

  logResult("冲突队列查询状态码 200", conflictsRes.status === 200, `status=${conflictsRes.status}`);
  logResult("冲突队列返回 items 数组", Array.isArray(conflictsRes.body.items),
    `items is Array: ${Array.isArray(conflictsRes.body.items)}`);

  const pendingConflict = conflictsRes.body.items.find((c) => c.operationId === opIdB);
  logResult("pending 队列中找到设备B的冲突", pendingConflict != null,
    pendingConflict ? `conflictId=${pendingConflict.id}` : "未找到");

  if (pendingConflict) {
    logResult("冲突状态为 pending", pendingConflict.status === "pending",
      `status=${pendingConflict.status}`);
    logResult("冲突关联正确的 animalId", pendingConflict.animalId === TEST_ANIMAL_ID,
      `animalId=${pendingConflict.animalId}`);
    logResult("冲突关联正确的日期", pendingConflict.date === TEST_DATE,
      `date=${pendingConflict.date}`);
    logResult("冲突记录了 incomingPayload", pendingConflict.incomingPayload?.weight === 21.5,
      `incomingWeight=${pendingConflict.incomingPayload?.weight}`);
    logResult("冲突记录了 conflictDetails", pendingConflict.conflictDetails != null,
      `has conflictDetails: ${pendingConflict.conflictDetails != null}`);
    logResult("冲突包含 conflictingFields",
      Array.isArray(pendingConflict.conflictDetails?.conflictingFields) &&
        pendingConflict.conflictDetails.conflictingFields.length > 0,
      `conflictingFields=${pendingConflict.conflictDetails?.conflictingFields?.length || 0}个`);
    logResult("冲突记录了现有操作 existingOperationId",
      pendingConflict.existingOperationId === opIdA,
      `existingOperationId=${pendingConflict.existingOperationId}`);
  }
}

async function testAdminResolveServerWins() {
  section("测试2: 管理员使用 server_wins 解决冲突");

  const opId1 = uid("svrwin-1");
  const opId2 = uid("svrwin-2");

  subSection("2.1 先提交两条冲突记录");
  await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opId1,
          operationType: "animal_note",
          keeper: "林青",
          clientCreatedAt: `${TEST_DATE}T09:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: "ani-1002",
            date: TEST_DATE,
            weight: 22.0,
            condition: "服务端原始记录"
          }
        }
      ]
    }
  });

  await sleep(100);

  await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opId2,
          operationType: "animal_note",
          keeper: "周遥",
          clientCreatedAt: `${TEST_DATE}T10:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: "ani-1002",
            date: TEST_DATE,
            weight: 23.0,
            condition: "客户端冲突记录"
          }
        }
      ]
    }
  });

  await sleep(100);

  subSection("2.2 查询并获取冲突ID");
  const listRes = await request("GET", "/sync/conflicts?status=pending&operationType=animal_note", {
    apiKey: KEYS.ADMIN
  });

  const conflict = listRes.body.items.find((c) => c.operationId === opId2);
  logResult("找到待处理冲突", conflict != null,
    conflict ? `conflictId=${conflict.id}` : "未找到");

  if (!conflict) {
    console.log("  \u26a0\ufe0f 未找到测试冲突，跳过此测试");
    return;
  }

  logResult("冲突初始状态为 pending", conflict.status === "pending",
    `status=${conflict.status}`);

  subSection("2.3 管理员调用 resolve 接口，策略 server_wins");
  const resolveRes = await request("POST", `/sync/conflicts/${conflict.id}/resolve`, {
    apiKey: KEYS.ADMIN,
    body: {
      strategy: "server_wins",
      note: "回归测试 - 采用服务端数据"
    }
  });

  logResult("resolve 请求状态码 200", resolveRes.status === 200,
    `status=${resolveRes.status}`);
  logResult("冲突状态变为 resolved_server_wins",
    resolveRes.body.conflict?.status === "resolved_server_wins",
    `status=${resolveRes.body.conflict?.status}`);
  logResult("记录了解决人 resolvedBy",
    resolveRes.body.conflict?.resolvedBy === "系统管理员",
    `resolvedBy=${resolveRes.body.conflict?.resolvedBy}`);
  logResult("记录了解决备注 resolutionNote",
    resolveRes.body.conflict?.resolutionNote === "回归测试 - 采用服务端数据",
    `note=${resolveRes.body.conflict?.resolutionNote}`);
  logResult("server_wins 不修改业务记录 (applied=false)",
    resolveRes.body.applied === false,
    `applied=${resolveRes.body.applied}`);
  logResult("记录了解决时间 resolvedAt",
    resolveRes.body.conflict?.resolvedAt != null,
    `resolvedAt=${resolveRes.body.conflict?.resolvedAt}`);
  logResult("记录了解决策略 resolutionStrategy",
    resolveRes.body.conflict?.resolutionStrategy === "server_wins",
    `strategy=${resolveRes.body.conflict?.resolutionStrategy}`);

  await sleep(100);

  subSection("2.4 验证冲突队列状态已更新");
  const detailRes = await request("GET", `/sync/conflicts/${conflict.id}`, {
    apiKey: KEYS.ADMIN
  });

  logResult("详情查询状态仍为 resolved_server_wins",
    detailRes.body.status === "resolved_server_wins",
    `status=${detailRes.body.status}`);

  subSection("2.5 验证动物记录未被修改（仍为服务端值）");
  const animalRes = await request("GET", "/animals/ani-1002", {
    apiKey: KEYS.ADMIN
  });

  const note = animalRes.body?.notes?.find((n) => n.date === TEST_DATE);
  logResult("动物记录 weight 仍为服务端值 22.0",
    note?.weight === 22.0,
    `weight=${note?.weight}`);
  logResult("动物记录 condition 仍为服务端值",
    note?.condition === "服务端原始记录",
    `condition=${note?.condition}`);
}

async function testAdminResolveClientWins() {
  section("测试3: 管理员使用 client_wins 解决冲突");

  const opId1 = uid("clwin-1");
  const opId2 = uid("clwin-2");

  subSection("3.1 先提交两条冲突记录");
  await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opId1,
          operationType: "animal_note",
          keeper: "林青",
          clientCreatedAt: `${TEST_DATE}T11:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: "ani-1003",
            date: TEST_DATE,
            weight: 16.0,
            condition: "服务端原始"
          }
        }
      ]
    }
  });

  await sleep(100);

  await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opId2,
          operationType: "animal_note",
          keeper: "周遥",
          clientCreatedAt: `${TEST_DATE}T12:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: "ani-1003",
            date: TEST_DATE,
            weight: 16.8,
            condition: "客户端修正值"
          }
        }
      ]
    }
  });

  await sleep(100);

  subSection("3.2 查询并获取冲突ID");
  const listRes = await request("GET", "/sync/conflicts?status=pending&operationType=animal_note", {
    apiKey: KEYS.ADMIN
  });

  const conflict = listRes.body.items.find((c) => c.operationId === opId2);
  logResult("找到待处理冲突", conflict != null,
    conflict ? `conflictId=${conflict.id}` : "未找到");

  if (!conflict) {
    console.log("  \u26a0\ufe0f 未找到测试冲突，跳过此测试");
    return;
  }

  subSection("3.3 管理员调用 resolve 接口，策略 client_wins");
  const resolveRes = await request("POST", `/sync/conflicts/${conflict.id}/resolve`, {
    apiKey: KEYS.ADMIN,
    body: {
      strategy: "client_wins",
      note: "回归测试 - 采用客户端数据"
    }
  });

  logResult("resolve 请求状态码 200", resolveRes.status === 200,
    `status=${resolveRes.status}`);
  logResult("冲突状态变为 resolved_client_wins",
    resolveRes.body.conflict?.status === "resolved_client_wins",
    `status=${resolveRes.body.conflict?.status}`);
  logResult("client_wins 已应用到业务记录 (applied=true)",
    resolveRes.body.applied === true,
    `applied=${resolveRes.body.applied}`);
  logResult("返回合并后的数据 result",
    resolveRes.body.result != null,
    `has result: ${resolveRes.body.result != null}`);
  logResult("记录了解决策略 resolutionStrategy",
    resolveRes.body.conflict?.resolutionStrategy === "client_wins",
    `strategy=${resolveRes.body.conflict?.resolutionStrategy}`);

  if (resolveRes.body.result?.note) {
    logResult("体重已更新为客户端值 16.8",
      resolveRes.body.result.note.weight === 16.8,
      `weight=${resolveRes.body.result.note.weight}`);
    logResult("状况描述已更新为客户端值",
      resolveRes.body.result.note.condition === "客户端修正值",
      `condition=${resolveRes.body.result.note.condition}`);
  }

  await sleep(100);

  subSection("3.4 验证动物记录已被客户端值覆盖");
  const animalRes = await request("GET", "/animals/ani-1003", {
    apiKey: KEYS.ADMIN
  });

  const note = animalRes.body?.notes?.find((n) => n.date === TEST_DATE);
  logResult("动物记录 weight 已更新为 16.8",
    note?.weight === 16.8,
    `weight=${note?.weight}`);
  logResult("动物记录 condition 已更新为客户端值",
    note?.condition === "客户端修正值",
    `condition=${note?.condition}`);
}

async function testKeeperCannotResolveConflict() {
  section("测试4: 饲养员不能直接解决冲突");

  const opId1 = uid("perm-1");
  const opId2 = uid("perm-2");

  subSection("4.1 创建冲突");
  await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opId1,
          operationType: "animal_note",
          keeper: "林青",
          clientCreatedAt: `${TEST_DATE}T13:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: "ani-2001",
            date: TEST_DATE,
            weight: 19.0,
            condition: "服务端"
          }
        }
      ]
    }
  });

  await sleep(100);

  await request("POST", "/sync/batch", {
    apiKey: KEYS.KEEPER,
    body: {
      operations: [
        {
          operationId: opId2,
          operationType: "animal_note",
          keeper: "周遥",
          clientCreatedAt: `${TEST_DATE}T14:00:00.000Z`,
          conflictStrategy: "reject",
          payload: {
            animalId: "ani-2001",
            date: TEST_DATE,
            weight: 19.5,
            condition: "客户端"
          }
        }
      ]
    }
  });

  await sleep(100);

  subSection("4.2 获取冲突ID");
  const listRes = await request("GET", "/sync/conflicts?status=pending", {
    apiKey: KEYS.ADMIN
  });

  const conflict = listRes.body.items.find((c) => c.operationId === opId2);
  if (!conflict) {
    console.log("  \u26a0\ufe0f 无 pending 冲突，跳过权限测试");
    return;
  }

  const conflictId = conflict.id;
  logResult("获取到冲突ID", true, `conflictId=${conflictId}`);

  subSection("4.3 饲养员调用 resolve 接口（应返回 403）");
  const keeperResolveRes = await request("POST", `/sync/conflicts/${conflictId}/resolve`, {
    apiKey: KEYS.KEEPER,
    body: {
      strategy: "client_wins",
      note: "饲养员尝试解决"
    }
  });

  logResult("饲养员调用 resolve 返回 403",
    keeperResolveRes.status === 403,
    `status=${keeperResolveRes.status}`);
  logResult("错误码为 insufficient_permission",
    keeperResolveRes.body?.error === "insufficient_permission",
    `error=${keeperResolveRes.body?.error}`);

  subSection("4.4 饲养员调用 dismiss 接口（应返回 403）");
  const keeperDismissRes = await request("POST", `/sync/conflicts/${conflictId}/dismiss`, {
    apiKey: KEYS.KEEPER,
    body: {
      note: "饲养员尝试忽略"
    }
  });

  logResult("饲养员调用 dismiss 返回 403",
    keeperDismissRes.status === 403,
    `status=${keeperDismissRes.status}`);
  logResult("错误码为 insufficient_permission",
    keeperDismissRes.body?.error === "insufficient_permission",
    `error=${keeperDismissRes.body?.error}`);

  subSection("4.5 验证冲突状态仍为 pending（未被修改）");
  const detailRes = await request("GET", `/sync/conflicts/${conflictId}`, {
    apiKey: KEYS.ADMIN
  });

  logResult("冲突状态仍为 pending",
    detailRes.body.status === "pending",
    `status=${detailRes.body.status}`);
}

async function main() {
  if (IS_VERIFY_MODE) {
    try {
      await runTests();
    } catch (err) {
      console.error("运行错误:", err.message);
      console.error(err.stack);
      process.exitCode = 1;
    }
    return;
  }

  console.log(`\n\x1b[36m\u267b  使用独立临时目录: ${TMP_DIR}\x1b[0m\n`);

  try {
    await startServer();
    await sleep(500);
    await runTests();
  } catch (err) {
    console.error("运行错误:", err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await stopServer();
    cleanupTmpDir();
    console.log(`\n\x1b[36m\u267b  临时目录已清理\x1b[0m`);
  }
}

main();
