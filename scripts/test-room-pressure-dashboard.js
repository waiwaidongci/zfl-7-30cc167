import http from "node:http";
import { spawn } from "node:child_process";
import { unlinkSync, existsSync, renameSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IS_VERIFY_MODE = process.env.VERIFY_MODE === "1";
const PORT = IS_VERIFY_MODE
  ? parseInt(new URL(process.env.VERIFY_BASE_URL).port, 10)
  : 3098;
const BASE = process.env.VERIFY_BASE_URL || `http://localhost:${PORT}`;

const KEYS = {
  ADMIN: "admin-key-demo-001",
  KEEPER: "keeper-key-demo-001",
  READONLY: "readonly-key-demo-001"
};

const DATA_FILES = [
  join(ROOT, "data", "lab.json"),
  join(ROOT, "data", "audit-logs.json")
];

let serverProc = null;
let passed = 0;
let failed = 0;
const results = [];

function backupData() {
  for (const f of DATA_FILES) {
    if (existsSync(f)) {
      try { renameSync(f, f + ".bak"); } catch (e) {}
    }
  }
}

function restoreData() {
  for (const f of DATA_FILES) {
    const bak = f + ".bak";
    if (existsSync(f)) {
      try { unlinkSync(f); } catch (e) {}
    }
    if (existsSync(bak)) {
      try { renameSync(bak, f); } catch (e) {}
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function logResult(name, ok, detail = "") {
  if (ok) passed++; else failed++;
  results.push({ name, ok, detail });
  const icon = ok ? "✓" : "✗";
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

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn("node", ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
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

const ROOM_METRICS = [
  "activeCageCount", "disabledCageCount", "occupancyRate",
  "quarantineAnimalCount", "breedingPairCount", "pendingHealthEventCount"
];

const SUMMARY_FIELDS = [
  "totalRooms", "totalActiveCages", "totalDisabledCages",
  "totalOccupied", "totalCapacity", "overallOccupancyRate",
  "totalQuarantineAnimals", "totalBreedingPairs", "totalPendingHealthEvents"
];

const SUMMARY_SUM_FIELDS = [
  "totalActiveCages", "totalDisabledCages", "totalOccupied",
  "totalCapacity", "totalQuarantineAnimals",
  "totalBreedingPairs", "totalPendingHealthEvents"
];

function summarizeRooms(adminByRoom, roomIds) {
  const visible = roomIds.map(id => adminByRoom[id]).filter(Boolean);
  const result = { totalRooms: visible.length };
  for (const sumField of SUMMARY_SUM_FIELDS) {
    result[sumField] = 0;
  }
  const roomFieldMap = {
    totalActiveCages: "activeCageCount",
    totalDisabledCages: "disabledCageCount",
    totalOccupied: "occupiedCount",
    totalCapacity: "totalCapacity",
    totalQuarantineAnimals: "quarantineAnimalCount",
    totalBreedingPairs: "breedingPairCount",
    totalPendingHealthEvents: "pendingHealthEventCount"
  };
  for (const room of visible) {
    for (const [sumField, roomField] of Object.entries(roomFieldMap)) {
      result[sumField] += (room[roomField] || 0);
    }
  }
  result.overallOccupancyRate = result.totalCapacity > 0
    ? Number(((result.totalOccupied / result.totalCapacity) * 100).toFixed(2))
    : 0;
  return result;
}

function arraysEqualSets(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

async function runTests() {
  console.log("=== 房间压力看板最小验证 ===\n");

  let adminResp = null;
  let adminScope = null;
  let keeperScope = null;

  console.log("[0] 根端点获取 allowedScope & 端点清单");
  {
    const [rAdmin, rKeeper] = await Promise.all([
      request("GET", "/", { apiKey: KEYS.ADMIN }),
      request("GET", "/", { apiKey: KEYS.KEEPER })
    ]);
    adminScope = rAdmin.body?.auth?.allowedScope || { rooms: [] };
    keeperScope = rKeeper.body?.auth?.allowedScope || { rooms: [] };
    const endpoints = rAdmin.body?.endpoints || [];
    const hasDashboard = endpoints.includes("GET /facility/room-pressure-dashboard");
    logResult("端点清单包含房间压力看板", hasDashboard,
      `adminAllowed=${JSON.stringify(adminScope.rooms)} keeperAllowed=${JSON.stringify(keeperScope.rooms)}`);
  }

  console.log("\n[1/7] admin 访问接口 → 200 + byRoom + summary");
  {
    const r = await request("GET", "/facility/room-pressure-dashboard", { apiKey: KEYS.ADMIN });
    adminResp = r.body;
    const ok = r.status === 200 && r.body && typeof r.body.byRoom === "object" && typeof r.body.summary === "object";
    logResult("admin 访问成功", ok,
      `status=${r.status} hasByRoom=${!!r.body?.byRoom} hasSummary=${!!r.body?.summary}`);
  }

  console.log("\n[2/7] 每房间包含6项核心指标");
  {
    const rooms = Object.values(adminResp?.byRoom || {});
    let allHaveAll = rooms.length > 0;
    for (const room of rooms) {
      for (const m of ROOM_METRICS) {
        if (!(m in room)) {
          allHaveAll = false;
          break;
        }
      }
    }
    logResult("所有房间含6项指标", allHaveAll,
      `rooms=${rooms.length} metrics=${ROOM_METRICS.join(",")}`);
  }

  console.log("\n[3/7] summary 包含9项汇总字段");
  {
    const s = adminResp?.summary || {};
    let allHaveAll = true;
    for (const f of SUMMARY_FIELDS) {
      if (!(f in s)) {
        allHaveAll = false;
        break;
      }
    }
    logResult("summary 字段完整", allHaveAll,
      `fields=${Object.keys(s).join(",") || "empty"}`);
  }

  console.log("\n[4/7] occupancyRate 为合法百分比数值(0-100,数值型)");
  {
    const rooms = Object.values(adminResp?.byRoom || {});
    let ratesValid = rooms.length > 0;
    for (const room of rooms) {
      const rate = room.occupancyRate;
      if (typeof rate !== "number" || rate < 0 || rate > 100) {
        ratesValid = false;
        break;
      }
    }
    const overallRate = adminResp?.summary?.overallOccupancyRate;
    const overallValid = typeof overallRate === "number" && overallRate >= 0 && overallRate <= 100;
    logResult("占用率数值合法", ratesValid && overallValid,
      `roomRatesValid=${ratesValid} overall=${overallRate}`);
  }

  console.log("\n[5/7] readonly 角色访问 → 200 (READ权限允许)");
  {
    const r = await request("GET", "/facility/room-pressure-dashboard", { apiKey: KEYS.READONLY });
    logResult("readonly 访问成功", r.status === 200, `status=${r.status}`);
  }

  console.log("\n[6/7] keeper allowedRoomIds 严格双向断言（正包含+反向排除）");
  {
    const r = await request("GET", "/facility/room-pressure-dashboard", { apiKey: KEYS.KEEPER });
    const keeperByRoom = r.body?.byRoom || {};
    const keeperRoomsArray = r.body?.rooms || [];
    const adminByRoom = adminResp?.byRoom || {};

    const allowed = keeperScope.rooms || [];
    const hasWildcard = allowed.includes("*");
    const keeperRoomIds = Object.keys(keeperByRoom);
    const keeperRoomIdsFromArray = keeperRoomsArray.map(rm => rm.id);

    let byRoomExact = true;
    let roomsArrayExact = true;

    if (hasWildcard) {
      byRoomExact = arraysEqualSets(keeperRoomIds, Object.keys(adminByRoom));
      roomsArrayExact = arraysEqualSets(keeperRoomIdsFromArray, (adminResp?.rooms || []).map(r => r.id));
    } else {
      byRoomExact = arraysEqualSets(keeperRoomIds, allowed.filter(id => adminByRoom[id]));
      roomsArrayExact = arraysEqualSets(
        keeperRoomIdsFromArray,
        (adminResp?.rooms || []).filter(r => allowed.includes(r.id)).map(r => r.id)
      );
    }

    let noLeak = true;
    for (const id of keeperRoomIds) {
      if (!adminByRoom[id]) {
        noLeak = false;
        break;
      }
    }

    const allGood = byRoomExact && roomsArrayExact && noLeak;
    logResult("keeper byRoom/rooms 与 allowedRoomIds 精确匹配", allGood,
      `allowed=${JSON.stringify(allowed)} wildcard=${hasWildcard} byRoom=${JSON.stringify(keeperRoomIds)} roomsArray=${JSON.stringify(keeperRoomIdsFromArray)} byRoomExact=${byRoomExact} roomsArrayExact=${roomsArrayExact}`);
  }

  console.log("\n[7/7] 权限过滤后 summary 9项字段逐项严格加总对齐（无数据泄漏）");
  {
    const rKeeper = await request("GET", "/facility/room-pressure-dashboard", { apiKey: KEYS.KEEPER });
    const keeperSummary = rKeeper.body?.summary || {};
    const adminByRoom = adminResp?.byRoom || {};
    const keeperByRoom = rKeeper.body?.byRoom || {};
    const keeperRoomIds = Object.keys(keeperByRoom);

    const expected = summarizeRooms(adminByRoom, keeperRoomIds);

    const diffs = [];
    for (const field of SUMMARY_FIELDS) {
      const actual = keeperSummary[field];
      const want = expected[field];
      if (typeof actual !== "number" || !Number.isFinite(actual)) {
        diffs.push(`${field}: 非数值 actual=${JSON.stringify(actual)}`);
        continue;
      }
      if (field === "overallOccupancyRate") {
        if (Math.abs(actual - want) > 0.01) {
          diffs.push(`${field}: actual=${actual} want=${want}`);
        }
      } else {
        if (actual !== want) {
          diffs.push(`${field}: actual=${actual} want=${want}`);
        }
      }
    }

    const allConsistent = diffs.length === 0;
    const detailMsg = allConsistent
      ? `visibleRooms=${keeperRoomIds.length} totalCapacity=${expected.totalCapacity} overall=${expected.overallOccupancyRate}%`
      : `diffs=[${diffs.join("; ")}]`;
    logResult("summary 全字段逐项严格加总对齐", allConsistent, detailMsg);
  }

  console.log("\n=== 汇总 ===");
  console.log(`通过: ${passed} / ${passed + failed}`);
  if (failed > 0) {
    console.log("\n失败项:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  ✗ ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\x1b[32m全部通过!\x1b[0m");
  }
}

function snapshotData() {
  const snapshot = {};
  for (const f of DATA_FILES) {
    if (existsSync(f)) {
      try { snapshot[f] = readFileSync(f, "utf8"); } catch (e) { snapshot[f] = null; }
    } else {
      snapshot[f] = null;
    }
  }
  return snapshot;
}

function dataMatchesSnapshot(snapshot) {
  for (const f of DATA_FILES) {
    const current = existsSync(f) ? readFileSync(f, "utf8") : null;
    if (current !== snapshot[f]) return false;
  }
  return true;
}

async function main() {
  if (IS_VERIFY_MODE) {
    try {
      await runTests();
    } catch (err) {
      console.error("运行错误:", err.message);
      process.exitCode = 1;
    }
    return;
  }

  const beforeSnapshot = snapshotData();
  backupData();
  try {
    await startServer();
    await runTests();
  } catch (err) {
    console.error("运行错误:", err.message);
    process.exitCode = 1;
  } finally {
    await stopServer();
    restoreData();
    const restored = dataMatchesSnapshot(beforeSnapshot);
    if (restored) {
      console.log("\n\x1b[36m♻ 数据已恢复，无测试污染\x1b[0m");
    } else {
      console.log("\n\x1b[33m⚠ 数据恢复后与快照不一致，可能存在残留\x1b[0m");
    }
  }
}

main();
