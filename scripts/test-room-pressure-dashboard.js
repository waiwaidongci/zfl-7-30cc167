import http from "node:http";
import { spawn } from "node:child_process";
import { unlinkSync, existsSync, renameSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 3098;
const BASE = `http://localhost:${PORT}`;

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

async function runTests() {
  console.log("=== 房间压力看板最小验证 ===\n");

  console.log("[1/7] admin 访问接口 → 200 + byRoom + summary");
  let adminResp = null;
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

  console.log("\n[6/7] keeper → byRoom中仅有白名单房间(不超过admin全量)");
  {
    const r = await request("GET", "/facility/room-pressure-dashboard", { apiKey: KEYS.KEEPER });
    const byRoom = r.body?.byRoom || {};
    const adminByRoom = adminResp?.byRoom || {};
    const roomIds = Object.keys(byRoom);
    const adminRoomIds = Object.keys(adminByRoom);
    const noExtra = roomIds.length > 0 && roomIds.every(id => adminRoomIds.includes(id));
    const subsetOk = roomIds.length <= adminRoomIds.length;
    logResult("keeper 权限过滤(子集关系)正确", noExtra && subsetOk,
      `keeper=${roomIds.join(",") || "empty"} adminTotal=${adminRoomIds.length}`);
  }

  console.log("\n[7/7] 权限过滤后 summary 仅汇总可见房间(与admin全量对比)");
  {
    const rKeeper = await request("GET", "/facility/room-pressure-dashboard", { apiKey: KEYS.KEEPER });
    const keeperSummary = rKeeper.body?.summary || {};
    const adminSummary = adminResp?.summary || {};
    const keeperByRoom = rKeeper.body?.byRoom || {};
    const keeperRoomIds = Object.keys(keeperByRoom);

    const expectedTotal = keeperRoomIds.length;
    const expectedActive = keeperRoomIds.reduce((s, id) => s + (adminResp?.byRoom?.[id]?.activeCageCount ?? 0), 0);

    const keeperTotal = keeperSummary.totalRooms;
    const keeperActive = keeperSummary.totalActiveCages;

    const consistent =
      keeperTotal === expectedTotal &&
      typeof keeperActive === "number" &&
      keeperActive === expectedActive &&
      adminSummary.totalRooms >= keeperTotal;

    logResult("权限过滤后 summary 汇总一致", consistent,
      `keeper:totalRooms=${keeperTotal} expected=${expectedTotal} active=${keeperActive} expectedActive=${expectedActive}`);
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
