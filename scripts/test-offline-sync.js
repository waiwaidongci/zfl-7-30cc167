import http from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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
        const keeper = list.find((k) => k.role === "admin" || k.role === "keeper");
        if (keeper) return keeper.key;
      } catch (e) {}
    }
  }
  return "keeper-key-demo-001";
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

function assert(condition, message, passDetails = "") {
  if (condition) {
    console.log(`  ✅ PASS: ${message}${passDetails ? " - " + passDetails : ""}`);
    return true;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    return false;
  }
}

function uid(prefix = "test") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let passed = 0;
let failed = 0;

function check(condition, message, passDetails = "") {
  if (assert(condition, message, passDetails)) {
    passed++;
  } else {
    failed++;
  }
}

async function runTests() {
  console.log("=".repeat(70));
  console.log("  离线巡检同步模块 - 综合验证脚本");
  console.log(`  API Base: ${BASE_URL}`);
  console.log(`  API Key:  ${API_KEY.substring(0, 10)}...`);
  console.log("=".repeat(70));

  try {
    await testSyncMeta();
    await testBasicAnimalNoteSync();
    await testIdempotentRetry();
    await testConflictDetection();
    await testMergeStrategies();
    await testMultipleOperationTypes();
    await testValidationErrors();
    await testQueryOperations();
    await testCageAbnormalReports();

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

async function testSyncMeta() {
  section("1. 获取同步接口元信息 GET /sync/meta");
  const res = await request("/sync/meta", "GET");
  check(res.status === 200, `状态码应为 200，实际 ${res.status}`);
  check(res.body.operationTypes, "返回 operationTypes");
  check(res.body.statuses, "返回 statuses");
  check(res.body.conflictStrategies, "返回 conflictStrategies");
  check(typeof res.body.batchSizeLimit === "number", `batchSizeLimit 是数字 (${res.body.batchSizeLimit})`);
  console.log("  元信息:", JSON.stringify(res.body, null, 2).split("\n").map((l) => "    " + l).join("\n"));
}

async function testBasicAnimalNoteSync() {
  section("2. 基础饲养记录同步 POST /sync/batch");

  const opId = uid("note");
  const body = {
    operations: [
      {
        operationId: opId,
        operationType: "animal_note",
        keeper: "林青",
        deviceId: "test-device-001",
        clientCreatedAt: "2099-12-31T08:30:00.000Z",
        payload: {
          animalId: "ani-1001",
          date: "2099-12-31",
          weight: 21.5,
          condition: "离线测试 - 食欲良好",
          photoPlaceholders: [
            { localPath: "test.jpg", size: 123456, takenAt: "2099-12-31T08:28:00.000Z", hash: "sha256:test123" }
          ]
        }
      }
    ]
  };

  subSection("2.1 首次提交");
  const res = await request("/sync/batch", "POST", body);
  console.log("  响应状态:", res.status);
  console.log("  响应体:", JSON.stringify(res.body, null, 2).split("\n").map((l) => "    " + l).join("\n"));

  check(res.status === 200, `状态码应为 200，实际 ${res.status}`);
  check(res.body.summary?.total === 1, `summary.total 应为 1，实际 ${res.body.summary?.total}`);
  check(res.body.summary?.applied === 1, `summary.applied 应为 1，实际 ${res.body.summary?.applied}`);
  check(res.body.results?.[0]?.status === "applied", `单条结果 status 应为 applied，实际 ${res.body.results?.[0]?.status}`);
  check(res.body.results?.[0]?.operationId === opId, `返回 operationId 匹配`);
  check(res.body.results?.[0]?.data?.note, "返回创建的 note 数据");
  check(res.body.results?.[0]?.data?.note?.weight === 21.5, `note.weight 应为 21.5，实际 ${res.body.results?.[0]?.data?.note?.weight}`);
}

async function testIdempotentRetry() {
  section("3. 幂等性测试 - 重复提交不重复写入");

  const opId = uid("idempotent");
  const body = {
    operations: [
      {
        operationId: opId,
        operationType: "animal_note",
        keeper: "林青",
        clientCreatedAt: "2099-12-31T09:00:00.000Z",
        payload: {
          animalId: "ani-1002",
          date: "2099-12-31",
          weight: 22.0,
          condition: "幂等性测试"
        }
      }
    ]
  };

  subSection("3.1 第一次提交");
  const res1 = await request("/sync/batch", "POST", body);
  check(res1.status === 200, `首次提交状态码 200`);
  check(res1.body.summary?.applied === 1, `首次提交 applied=1`);
  check(res1.body.results?.[0]?.status === "applied", `首次状态为 applied`);
  const firstNoteId = res1.body.results?.[0]?.data?.note?.id;
  console.log(`  首次创建 noteId: ${firstNoteId}`);

  subSection("3.2 第二次提交（相同 operationId）");
  const res2 = await request("/sync/batch", "POST", body);
  check(res2.status === 200, `重复提交状态码 200`);
  check(res2.body.summary?.duplicates === 1, `重复提交 duplicates=1，实际 ${res2.body.summary?.duplicates}`);
  check(res2.body.results?.[0]?.status === "duplicate", `重复提交状态应为 duplicate，实际 ${res2.body.results?.[0]?.status}`);
  check(res2.body.results?.[0]?.duplicateOf, `返回 duplicateOf 信息`);
  check(res2.body.results?.[0]?.duplicateOf?.operationId === opId, `duplicateOf.operationId 匹配`);
  console.log(`  重复提交响应: status=${res2.body.results?.[0]?.status}, duplicateOf=${JSON.stringify(res2.body.results?.[0]?.duplicateOf)}`);
}

async function testConflictDetection() {
  section("4. 冲突检测测试 - 同一动物同一天多端提交");

  const opId1 = uid("conflict-a");
  const opId2 = uid("conflict-b");

  subSection("4.1 先由饲养员A提交一条记录");
  const res1 = await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId1,
        operationType: "animal_note",
        keeper: "周遥",
        deviceId: "device-A",
        clientCreatedAt: "2099-12-31T07:00:00.000Z",
        payload: {
          animalId: "ani-1003",
          date: "2099-12-31",
          weight: 16.5,
          condition: "A端 - 状态正常"
        }
      }
    ]
  });
  check(res1.status === 200, `A端首次提交成功`);
  check(res1.body.summary?.applied === 1, `A端 applied=1`);

  subSection("4.2 饲养员B提交同动物同天记录（默认策略 merge_non_conflict）");
  const res2 = await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opId2,
        operationType: "animal_note",
        keeper: "林青",
        deviceId: "device-B",
        clientCreatedAt: "2099-12-31T10:00:00.000Z",
        payload: {
          animalId: "ani-1003",
          date: "2099-12-31",
          weight: 16.8,
          condition: "B端 - 状态正常"
        }
      }
    ]
  });

  console.log("  B端响应:", JSON.stringify(res2.body, null, 2).split("\n").map((l) => "    " + l).join("\n"));

  check(res2.status === 200 || res2.status === 409, `冲突响应状态码应为 200 或 409，实际 ${res2.status}`);
  check(res2.body.summary?.conflicts === 1 || res2.body.summary?.partial === 1, `检测到冲突或部分合并`);

  const result = res2.body.results?.[0];
  if (result?.conflict) {
    check(result.conflict.conflictingFields?.length > 0, `返回冲突字段列表 (${result.conflict.conflictingFields?.length}个)`);
    check(result.conflict.explanation, `返回可解释的冲突说明`);
    check(result.conflict.animalId === "ani-1003", `冲突关联正确的 animalId`);
    check(result.conflict.date === "2099-12-31", `冲突关联正确的日期`);
    console.log(`  冲突说明: ${result.conflict.explanation}`);
    console.log(`  冲突字段: ${result.conflict.conflictingFields?.map((f) => f.field).join(", ")}`);
  }
}

async function testMergeStrategies() {
  section("5. 合并策略测试");

  subSection("5.1 策略 reject - 冲突即拒绝");
  const opReject = uid("reject");
  const opReject2 = uid("reject-2");

  await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opReject,
        operationType: "animal_note",
        keeper: "林青",
        clientCreatedAt: "2099-12-31T11:00:00.000Z",
        payload: { animalId: "ani-1004", date: "2099-12-31", weight: 15.0, condition: "原始记录" }
      }
    ]
  });

  const resReject = await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opReject2,
        operationType: "animal_note",
        keeper: "周遥",
        clientCreatedAt: "2099-12-31T11:30:00.000Z",
        conflictStrategy: "reject",
        payload: { animalId: "ani-1004", date: "2099-12-31", weight: 15.2 }
      }
    ]
  });
  check(resReject.body.results?.[0]?.status === "conflict", `reject 策略返回 conflict 状态`);
  check(resReject.body.results?.[0]?.error?.code === "conflict_rejected", `返回 conflict_rejected 错误码`);

  subSection("5.2 策略 client_wins - 客户端覆盖服务端");
  const opCw = uid("cw");
  const resCw = await request("/sync/batch", "POST", {
    operations: [
      {
        operationId: opCw,
        operationType: "animal_note",
        keeper: "林青",
        clientCreatedAt: "2099-12-31T12:00:00.000Z",
        conflictStrategy: "client_wins",
        payload: { animalId: "ani-1004", date: "2099-12-31", weight: 15.5, condition: "客户端覆盖" }
      }
    ]
  });
  const cwStatus = resCw.body.results?.[0]?.status;
  check(cwStatus === "partial" || cwStatus === "applied", `client_wins 策略返回 partial 或 applied (实际: ${cwStatus})`);
  if (resCw.body.results?.[0]?.mergedFields) {
    console.log(`  合并字段: ${resCw.body.results?.[0].mergedFields.join(", ")}`);
  }
}

async function testMultipleOperationTypes() {
  section("6. 多操作类型混合批量同步");

  const today = "2099-12-31";
  const body = {
    operations: [
      {
        operationId: uid("mix-note"),
        operationType: "animal_note",
        keeper: "林青",
        clientCreatedAt: `${today}T08:00:00.000Z`,
        payload: {
          animalId: "ani-1001",
          date: today,
          weight: 21.7,
          condition: "混合批量测试 - note",
          photoPlaceholders: [{ localPath: "mix.jpg", size: 1000, takenAt: `${today}T07:59:00.000Z`, hash: "mixhash" }]
        }
      },
      {
        operationId: uid("mix-move"),
        operationType: "animal_move",
        keeper: "林青",
        clientCreatedAt: `${today}T08:10:00.000Z`,
        payload: {
          animalId: "ani-1002",
          cageId: "B-04",
          reason: "混合批量测试 - 移笼"
        }
      },
      {
        operationId: uid("mix-feed"),
        operationType: "feeding_record",
        keeper: "林青",
        clientCreatedAt: `${today}T08:15:00.000Z`,
        payload: {
          targetType: "animal",
          targetId: "ani-1001",
          feedType: "标准颗粒饲料",
          amount: 2.5,
          condition: "进食良好",
          notes: "混合批量测试"
        }
      },
      {
        operationId: uid("mix-cage"),
        operationType: "cage_abnormal",
        keeper: "林青",
        clientCreatedAt: `${today}T08:20:00.000Z`,
        payload: {
          cageId: "C-01",
          abnormalType: "hygiene",
          severity: "minor",
          description: "混合批量测试 - 笼位需清洁",
          photoPlaceholders: [{ localPath: "cage.jpg", size: 2000, takenAt: `${today}T08:19:00.000Z`, hash: "cagehash" }]
        }
      }
    ]
  };

  const res = await request("/sync/batch", "POST", body);
  console.log("  批量响应摘要:", JSON.stringify(res.body.summary, null, 2));

  check(res.status === 200, `混合批量状态码 200`);
  check(res.body.summary?.total === 4, `总数 4，实际 ${res.body.summary?.total}`);
  check(res.body.summary?.applied >= 0, `至少 0 条 applied`);

  if (!Array.isArray(res.body.results)) {
    console.log("  ❌ 无 results 数组，响应:", JSON.stringify(res.body).substring(0, 200));
    return;
  }

  for (let i = 0; i < res.body.results.length; i++) {
    const r = res.body.results[i];
    const opType = body.operations[i].operationType;
    console.log(`  [${i + 1}] ${opType}: status=${r.status}${r.data ? " ✅有数据" : ""}${r.conflict ? " ⚠️冲突" : ""}${r.error ? " ❌错误: " + r.error.code : ""}`);
    if (r.data?.note) console.log(`       note: weight=${r.data.note.weight}, condition=${r.data.note.condition?.substring(0, 20)}`);
    if (r.data?.move) console.log(`       move: ${r.data.move.from} -> ${r.data.move.to}`);
    if (r.data?.record) console.log(`       feed: ${r.data.record.feedType} ${r.data.record.amount}g`);
    if (r.data?.report) console.log(`       cage: ${r.data.report.abnormalType} ${r.data.report.severity}`);
  }
}

async function testValidationErrors() {
  section("7. 验证错误测试");

  subSection("7.1 空批次");
  const resEmpty = await request("/sync/batch", "POST", { operations: [] });
  check(resEmpty.status === 400, `空批次返回 400，实际 ${resEmpty.status}`);
  check(resEmpty.body.error === "empty_batch", `错误码 empty_batch`);

  subSection("7.2 缺少 operationId");
  const resNoId = await request("/sync/batch", "POST", {
    operations: [{ operationType: "animal_note", keeper: "林青", payload: { animalId: "ani-1001" } }]
  });
  check(resNoId.body.summary?.errors === 1, `缺少 operationId 产生 1 条 error`);
  check(resNoId.body.results?.[0]?.error?.code === "validation_failed", `错误码 validation_failed`);

  subSection("7.3 无效 operationType");
  const resBadType = await request("/sync/batch", "POST", {
    operations: [{ operationId: uid("bad"), operationType: "invalid_type", keeper: "林青", payload: {} }]
  });
  check(resBadType.body.results?.[0]?.status === "error", `无效类型返回 error 状态`);

  subSection("7.4 animal_note 缺少 animalId");
  const resNoAnimal = await request("/sync/batch", "POST", {
    operations: [{ operationId: uid("noanimal"), operationType: "animal_note", keeper: "林青", payload: { weight: 20 } }]
  });
  check(resNoAnimal.body.results?.[0]?.error?.details?.[0]?.field?.includes("animalId"), `缺少 animalId 的验证错误`);
}

async function testQueryOperations() {
  section("8. 同步操作历史查询");

  subSection("8.1 GET /sync/operations");
  const res = await request("/sync/operations", "GET");
  check(res.status === 200, `状态码 200`);
  check(Array.isArray(res.body), `返回数组`);
  console.log(`  共返回 ${res.body.length} 条同步操作记录`);
  if (res.body.length > 0) {
    const latest = res.body[0];
    console.log(`  最新记录:`);
    console.log(`    operationId: ${latest.operationId}`);
    console.log(`    operationType: ${latest.operationType}`);
    console.log(`    status: ${latest.status}`);
    console.log(`    keeper: ${latest.keeper}`);
    console.log(`    submittedAt: ${latest.submittedAt}`);
  }

  subSection("8.2 GET /sync/operations?status=applied");
  const resFiltered = await request("/sync/operations?status=applied", "GET");
  check(resFiltered.status === 200, `过滤查询状态码 200`);
  check(Array.isArray(resFiltered.body), `返回数组`);
  const allApplied = resFiltered.body.every((op) => op.status === "applied");
  check(allApplied, `所有返回结果 status=applied`);

  subSection("8.3 GET /sync/operations/:id");
  if (res.body.length > 0) {
    const firstOp = res.body[0];
    const resSingle = await request(`/sync/operations/${encodeURIComponent(firstOp.operationId)}`, "GET");
    check(resSingle.status === 200, `单条查询状态码 200`);
    check(resSingle.body?.operationId === firstOp.operationId, `单条查询返回正确的 operationId`);
  }
}

async function testCageAbnormalReports() {
  section("9. 笼位异常上报查询");

  subSection("9.1 GET /sync/cage-abnormal");
  const res = await request("/sync/cage-abnormal", "GET");
  check(res.status === 200, `状态码 200`);
  check(Array.isArray(res.body), `返回数组`);
  console.log(`  共返回 ${res.body.length} 条笼位异常记录`);

  if (res.body.length > 0) {
    const latest = res.body[0];
    console.log(`  最新记录:`);
    console.log(`    id: ${latest.id}`);
    console.log(`    cageId: ${latest.cageId}`);
    console.log(`    abnormalType: ${latest.abnormalType}`);
    console.log(`    severity: ${latest.severity}`);
    console.log(`    description: ${latest.description?.substring(0, 30)}`);
    console.log(`    photoPlaceholders: ${latest.photoPlaceholders?.length || 0} 张照片占位`);
  }

  subSection("9.2 GET /sync/cage-abnormal?severity=minor");
  const resFiltered = await request("/sync/cage-abnormal?severity=minor", "GET");
  check(resFiltered.status === 200, `按严重程度过滤状态码 200`);
}

runTests();
