import http from "node:http";
import { spawn } from "node:child_process";
import { unlinkSync, existsSync, renameSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;

const KEYS = {
  ADMIN: "admin-key-demo-001",
  KEEPER: "keeper-key-demo-001",
  READONLY: "readonly-key-demo-001",
  INVALID: "invalid-key-12345"
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

async function runTests() {
  console.log("=== API权限与审计模块最小验证 ===\n");

  console.log("[1/12] 无Key访问 → 401");
  {
    const r = await request("GET", "/animals");
    logResult("缺少Key返回401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n[2/12] 无效Key → 401");
  {
    const r = await request("GET", "/animals", { apiKey: KEYS.INVALID });
    logResult("无效Key返回401", r.status === 401, `status=${r.status}`);
  }

  console.log("\n[3/12] readonly写操作 → 403");
  {
    const r = await request("POST", "/animals", {
      apiKey: KEYS.READONLY,
      body: { strain: "C57", cageId: "A-01", sex: "male", birthDate: "2026-01-01", project: "test", keeper: "T" }
    });
    logResult("readonly写动物返回403", r.status === 403, `status=${r.status}`);
  }

  console.log("\n[4/12] keeper操作cage(admin) → 403");
  {
    const r = await request("POST", "/cages", {
      apiKey: KEYS.KEEPER,
      body: { area: "TEST", rack: "T", capacity: 5 }
    });
    logResult("keeper新增笼位返回403", r.status === 403, `status=${r.status}`);
  }

  console.log("\n[5/12] admin操作cage → 200/201");
  {
    const r = await request("POST", "/cages", {
      apiKey: KEYS.ADMIN,
      body: { id: "T-99", area: "TEST区", rack: "T", capacity: 5 }
    });
    const ok = r.status === 200 || r.status === 201;
    logResult("admin新增笼位成功", ok, `status=${r.status}`);
  }

  console.log("\n[6/12] keeper写动物(建档) → 201 + 审计");
  let newAnimalId = null;
  {
    const r = await request("POST", "/animals", {
      apiKey: KEYS.KEEPER,
      body: {
        strain: "C57BL/6J", cageId: "C-01", sex: "female",
        birthDate: "2026-05-01", project: "验证项目", keeper: "测试饲养员"
      }
    });
    newAnimalId = r.body?.id;
    logResult("keeper建档成功", r.status === 201 && newAnimalId,
      `status=${r.status} id=${newAnimalId || "N/A"}`);
  }

  await sleep(500);

  console.log("\n[7/12] 按动物ID查询审计日志");
  {
    const r = await request("GET", `/audit/logs?animalId=${encodeURIComponent(newAnimalId || "")}`, {
      apiKey: KEYS.ADMIN
    });
    const logs = Array.isArray(r.body?.logs) ? r.body.logs : Array.isArray(r.body) ? r.body : [];
    const found = logs.some((l) =>
      (l.animalIds || []).includes(newAnimalId) ||
      (Array.isArray(l.animalIds) && l.animalIds[0] === newAnimalId)
    );
    const listOk = Array.isArray(logs);
    logResult("admin访问audit接口成功", r.status === 200 && listOk,
      `status=${r.status} count=${logs.length}`);
    if (newAnimalId) {
      logResult("按动物ID找到审计记录", found, `animalId=${newAnimalId}`);
    }
  }

  console.log("\n[8/12] 按操作者Key查询审计日志");
  {
    const r = await request("GET", `/audit/logs?operatorKey=${encodeURIComponent(KEYS.KEEPER)}`, {
      apiKey: KEYS.ADMIN
    });
    const logs = Array.isArray(r.body?.logs) ? r.body.logs : Array.isArray(r.body) ? r.body : [];
    const found = logs.some((l) =>
      l.operator?.key === KEYS.KEEPER ||
      l.operatorKey === KEYS.KEEPER
    );
    logResult("按操作者Key找到审计记录", r.status === 200 && found,
      `status=${r.status} count=${logs.length}`);
  }

  console.log("\n[9/12] readonly访问audit/stats → 403");
  {
    const r = await request("GET", "/audit/stats", { apiKey: KEYS.READONLY });
    logResult("readonly访问audit/stats返回403", r.status === 403, `status=${r.status}`);
  }

  console.log("\n[10/12] keeper访问audit/stats → 403");
  {
    const r = await request("GET", "/audit/stats", { apiKey: KEYS.KEEPER });
    logResult("keeper访问audit/stats返回403", r.status === 403, `status=${r.status}`);
  }

  console.log("\n[11/12] admin访问audit/stats → 200");
  {
    const r = await request("GET", "/audit/stats", { apiKey: KEYS.ADMIN });
    const hasTotal = typeof r.body?.total === "number";
    logResult("admin访问audit/stats成功", r.status === 200 && hasTotal,
      `status=${r.status} total=${r.body?.total ?? "N/A"}`);
  }

  console.log("\n[12/12] admin访问audit/operations → 200（keeper/readonly已被stats验证覆盖）");
  {
    const rStatsKeeper = await request("GET", "/audit/operations", { apiKey: KEYS.KEEPER });
    const rOpsAdmin = await request("GET", "/audit/operations", { apiKey: KEYS.ADMIN });
    const hasOps = rOpsAdmin.body && typeof rOpsAdmin.body === "object" && (rOpsAdmin.body.operations || Object.keys(rOpsAdmin.body).length > 0);
    logResult("keeper访问audit/operations返回403", rStatsKeeper.status === 403, `status=${rStatsKeeper.status}`);
    logResult("admin访问audit/operations成功", rOpsAdmin.status === 200 && hasOps,
      `status=${rOpsAdmin.status} keys=${Object.keys(rOpsAdmin.body || {}).join(",") || "empty"}`);
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
