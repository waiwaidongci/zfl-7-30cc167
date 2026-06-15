import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "config", "api-keys.json");

const BASE_URL = "http://localhost:3007";

function loadApiKey() {
  const candidates = [configPath, join(__dirname, "..", "config", "api-keys.example.json")];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const cfg = JSON.parse(readFileSync(p, "utf8"));
        const list = Array.isArray(cfg.apiKeys) ? cfg.apiKeys : Object.values(cfg);
        const admin = list.find((k) => k.role === "admin");
        if (admin) return admin.key;
      } catch (e) {}
    }
  }
  return "admin-key-demo-001";
}

const API_KEY = loadApiKey();

function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY
      }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
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

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function uid(prefix = "test") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const TEST_DATE = new Date(Date.UTC(2099, 5, 15)).toISOString().slice(0, 10);

async function runTests() {
  console.log("=".repeat(70));
  console.log("  冲突待处理队列 - 验证测试");
  console.log(`  API Base: ${BASE_URL}`);
  console.log(`  API Key:  ${API_KEY.substring(0, 10)}...`);
  console.log("=".repeat(70));

  try {
    await testConflictListEndpoint();
    await testConflictDetailEndpoint();
    await testConflictFilters();
    await testConflictResolveServerWins();
    await testConflictResolveClientWins();
    await testConflictDismiss();
    await testKeeperCannotResolve();

    section("测试总结");
    console.log(`\n  通过: ${passed}`);
    console.log(`  失败: ${failed}`);
    console.log(`  总计: ${passed + failed}`);
    console.log(`\n  结果: ${failed === 0 ? "✅ 全部通过" : "❌ 存在失败"}`);

    process.exit(failed === 0 ? 0 : 1);
  } catch (error) {
    console.error("\n测试执行出错:", error.message);
    console.error(error.stack);
    process.exit(2);
  }
}

async function testConflictListEndpoint() {
  section("1. 查询冲突队列 GET /sync/conflicts");

  const res = await request("/sync/conflicts", "GET");
  check(res.status === 200, `状态码应为 200，实际 ${res.status}`);
  check(typeof res.body.total === "number", `返回 total 字段 (${res.body.total})`);
  check(Array.isArray(res.body.items), `返回 items 数组`);

  console.log(`  当前冲突总数: ${res.body.total}`);
}

async function testConflictDetailEndpoint() {
  section("2. 查询单条冲突详情 GET /sync/conflicts/:id");

  const listRes = await request("/sync/conflicts?status=pending", "GET");
  if (listRes.body.items.length === 0) {
    console.log("  ⚠️ 无 pending 状态冲突，跳过详情查询测试");
    return;
  }

  const firstId = listRes.body.items[0].id;
  const res = await request(`/sync/conflicts/${firstId}`, "GET");

  check(res.status === 200, `状态码应为 200，实际 ${res.status}`);
  check(res.body.id === firstId, `返回正确的冲突 ID`);
  check(res.body.status !== undefined, `包含 status 字段`);
  check(res.body.conflictDetails !== undefined, `包含 conflictDetails 字段`);
  check(res.body.incomingPayload !== undefined, `包含 incomingPayload 字段`);

  console.log(`  冲突 ID: ${res.body.id}`);
  console.log(`  状态: ${res.body.status}`);
  console.log(`  操作类型: ${res.body.operationType}`);
}

async function testConflictFilters() {
  section("3. 冲突队列过滤查询");

  subSection("3.1 按 keeper 过滤");
  const resKeeper = await request("/sync/conflicts?keeper=林青", "GET");
  check(resKeeper.status === 200, `状态码 200`);
  const allLinqing = resKeeper.body.items.every((c) => c.keeper === "林青");
  check(allLinqing, `所有返回结果 keeper=林青`);

  subSection("3.2 按 operationType 过滤");
  const resType = await request("/sync/conflicts?operationType=animal_note", "GET");
  check(resType.status === 200, `状态码 200`);
  const allNote = resType.body.items.every((c) => c.operationType === "animal_note");
  check(allNote, `所有返回结果 operationType=animal_note`);

  subSection("3.3 按 roomId 过滤");
  const resRoom = await request("/sync/conflicts?roomId=room-default", "GET");
  check(resRoom.status === 200, `状态码 200`);
  const allDefaultRoom = resRoom.body.items.every((c) => c.roomId === "room-default");
  check(allDefaultRoom, `所有返回结果 roomId=room-default`);

  subSection("3.4 按 status 过滤");
  const resPending = await request("/sync/conflicts?status=pending", "GET");
  check(resPending.status === 200, `状态码 200`);
  const allPending = resPending.body.items.every((c) => c.status === "pending");
  check(allPending, `所有返回结果 status=pending`);
}

async function testConflictResolveServerWins() {
  section("4. 解决冲突 - server_wins 策略");

  const opId1 = uid("svrwin-a");
  const opId2 = uid("svrwin-b");

  await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId1,
        operationType: "animal_note",
        keeper: "周遥",
        clientCreatedAt: `${TEST_DATE}T07:00:00.000Z`,
        conflictStrategy: "reject",
        payload: {
          animalId: "ani-1001",
          date: TEST_DATE,
          weight: 20.0,
          condition: "服务端原始记录"
        }
      }
    ]
  });

  await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId2,
        operationType: "animal_note",
        keeper: "林青",
        clientCreatedAt: `${TEST_DATE}T08:00:00.000Z`,
        conflictStrategy: "reject",
        payload: {
          animalId: "ani-1001",
          date: TEST_DATE,
          weight: 21.0,
          condition: "客户端提交记录"
        }
      }
    ]
  });

  const listRes = await request("/sync/conflicts?status=pending&operationType=animal_note", "GET");
  const conflict = listRes.body.items.find((c) => c.operationId === opId2);

  if (!conflict) {
    console.log("  ⚠️ 未找到测试冲突，跳过");
    return;
  }

  check(conflict.status === "pending", `冲突状态为 pending`);
  check(conflict.keeper === "林青", `冲突所属饲养员正确`);

  const resolveRes = await request(`/sync/conflicts/${conflict.id}/resolve`, "POST", {
    strategy: "server_wins",
    note: "测试 server_wins 解决策略"
  });

  check(resolveRes.status === 200, `解决请求状态码 200`);
  check(resolveRes.body.conflict.status === "resolved_server_wins", `冲突状态变为 resolved_server_wins`);
  check(resolveRes.body.conflict.resolvedBy === "系统管理员", `记录了解决人`);
  check(resolveRes.body.applied === false, `server_wins 不修改业务记录`);

  console.log(`  解决后状态: ${resolveRes.body.conflict.status}`);
  console.log(`  解决人: ${resolveRes.body.conflict.resolvedBy}`);
}

async function testConflictResolveClientWins() {
  section("5. 解决冲突 - client_wins 策略");

  const opId1 = uid("clwin-a");
  const opId2 = uid("clwin-b");

  await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId1,
        operationType: "animal_note",
        keeper: "周遥",
        clientCreatedAt: `${TEST_DATE}T09:00:00.000Z`,
        conflictStrategy: "reject",
        payload: {
          animalId: "ani-1002",
          date: TEST_DATE,
          weight: 22.0,
          condition: "服务端原始"
        }
      }
    ]
  });

  await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId2,
        operationType: "animal_note",
        keeper: "林青",
        clientCreatedAt: `${TEST_DATE}T10:00:00.000Z`,
        conflictStrategy: "reject",
        payload: {
          animalId: "ani-1002",
          date: TEST_DATE,
          weight: 23.5,
          condition: "客户端修正"
        }
      }
    ]
  });

  const listRes = await request("/sync/conflicts?status=pending&operationType=animal_note", "GET");
  const conflict = listRes.body.items.find((c) => c.operationId === opId2);

  if (!conflict) {
    console.log("  ⚠️ 未找到测试冲突，跳过");
    return;
  }

  const resolveRes = await request(`/sync/conflicts/${conflict.id}/resolve`, "POST", {
    strategy: "client_wins",
    note: "测试 client_wins 解决策略"
  });

  check(resolveRes.status === 200, `解决请求状态码 200`);
  check(resolveRes.body.conflict.status === "resolved_client_wins", `冲突状态变为 resolved_client_wins`);
  check(resolveRes.body.applied === true, `client_wins 已应用到业务记录`);
  check(resolveRes.body.result !== undefined, `返回合并后的数据`);

  if (resolveRes.body.result?.note) {
    check(resolveRes.body.result.note.weight === 23.5, `体重已更新为客户端值 (23.5)`);
    check(resolveRes.body.result.note.condition === "客户端修正", `状况描述已更新为客户端值`);
  }

  console.log(`  解决后状态: ${resolveRes.body.conflict.status}`);
  console.log(`  合并后体重: ${resolveRes.body.result?.note?.weight}`);
}

async function testConflictDismiss() {
  section("6. 忽略冲突 (dismiss)");

  const opId1 = uid("dismiss-a");
  const opId2 = uid("dismiss-b");

  await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId1,
        operationType: "animal_note",
        keeper: "周遥",
        clientCreatedAt: `${TEST_DATE}T11:00:00.000Z`,
        conflictStrategy: "reject",
        payload: {
          animalId: "ani-2001",
          date: TEST_DATE,
          weight: 19.0,
          condition: "服务端记录"
        }
      }
    ]
  });

  await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId2,
        operationType: "animal_note",
        keeper: "林青",
        clientCreatedAt: `${TEST_DATE}T12:00:00.000Z`,
        conflictStrategy: "reject",
        payload: {
          animalId: "ani-2001",
          date: TEST_DATE,
          weight: 19.5,
          condition: "客户端误提交"
        }
      }
    ]
  });

  const listRes = await request("/sync/conflicts?status=pending&operationType=animal_note", "GET");
  const conflict = listRes.body.items.find((c) => c.operationId === opId2);

  if (!conflict) {
    console.log("  ⚠️ 未找到测试冲突，跳过");
    return;
  }

  const dismissRes = await request(`/sync/conflicts/${conflict.id}/dismiss`, "POST", {
    note: "客户端误提交，忽略此冲突"
  });

  check(dismissRes.status === 200, `忽略请求状态码 200`);
  check(dismissRes.body.conflict.status === "dismissed", `冲突状态变为 dismissed`);
  check(dismissRes.body.conflict.resolutionNote === "客户端误提交，忽略此冲突", `记录了解决备注`);

  console.log(`  忽略后状态: ${dismissRes.body.conflict.status}`);
  console.log(`  忽略备注: ${dismissRes.body.conflict.resolutionNote}`);
}

async function testKeeperCannotResolve() {
  section("7. 权限验证 - 饲养员无法解决冲突");

  const keeperKey = "keeper-key-demo-001";

  const listRes = await request("/sync/conflicts?status=pending", "GET");

  if (listRes.body.items.length === 0) {
    console.log("  ⚠️ 无 pending 冲突，跳过权限测试");
    return;
  }

  const conflictId = listRes.body.items[0].id;

  const url = new URL(`/sync/conflicts/${conflictId}/resolve`, BASE_URL);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": keeperKey
    }
  };

  const res = await new Promise((resolve) => {
    const req = http.request(options, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: r.statusCode, body: data }); }
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
    req.write(JSON.stringify({ strategy: "client_wins" }));
    req.end();
  });

  check(res.status === 403, `饲养员调用 resolve 返回 403，实际 ${res.status}`);
  check(res.body.error === "insufficient_permission", `错误码为 insufficient_permission`);

  console.log(`  状态码: ${res.status}`);
  console.log(`  错误: ${res.body.error}`);
}

runTests();
