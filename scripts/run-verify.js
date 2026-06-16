#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const SUITE_CONFIG = {
  "auth-audit": {
    label: "认证审计验证",
    script: "test-auth-audit.js",
    needsServer: true,
    category: "认证审计"
  },
  "ledger": {
    label: "事件台账校验",
    script: "test-ledger.js",
    needsServer: false,
    category: "事件台账"
  },
  "consistency": {
    label: "数据一致性巡检",
    script: "data-consistency-check.js",
    needsServer: false,
    category: "数据一致性"
  },
  "sync": {
    label: "离线同步验证",
    script: "test-offline-sync.js",
    needsServer: true,
    category: "离线同步"
  },
  "conflict": {
    label: "冲突队列验证",
    script: "test-conflict-queue.js",
    needsServer: true,
    category: "离线同步"
  },
  "conflict-regression": {
    label: "冲突队列回归测试",
    script: "test-conflict-queue-regression.js",
    needsServer: true,
    category: "离线同步"
  },
  "batch-import": {
    label: "批量导入验证",
    script: "test-batch-import.js",
    needsServer: true,
    category: "批量导入"
  },
  "feeding": {
    label: "饲喂日程验证",
    script: "test-feeding-schedule.js",
    needsServer: false,
    category: "饲喂日程"
  },
  "room-pressure": {
    label: "房间压力看板验证",
    script: "test-room-pressure-dashboard.js",
    needsServer: true,
    category: "设施看板"
  }
};

const GROUPS = {
  all: Object.keys(SUITE_CONFIG),
  quick: ["consistency", "ledger", "feeding"],
  api: Object.keys(SUITE_CONFIG).filter(k => SUITE_CONFIG[k].needsServer)
};

const SUITES = Object.entries(SUITE_CONFIG).map(([id, cfg]) => ({
  id,
  ...cfg,
  script: join(ROOT, "scripts", cfg.script)
}));

function parseArgs(argv) {
  const args = argv.slice(2);
  const selected = [];
  let ci = false;
  let verbose = false;
  let jsonOutput = false;

  for (const arg of args) {
    if (arg === "--ci") { ci = true; continue; }
    if (arg === "--verbose" || arg === "-v") { verbose = true; continue; }
    if (arg === "--json") { jsonOutput = true; continue; }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    for (const part of arg.split(",")) {
      const trimmed = part.trim();
      if (trimmed) selected.push(trimmed);
    }
  }

  return { selected, ci, verbose, json: jsonOutput };
}

function printHelp() {
  const ids = Object.keys(SUITE_CONFIG);
  console.log(`
验证入口 - 统一运行分散的测试/巡检/校验脚本

用法:
  node scripts/run-verify.js [类别...] [选项]

类别:
${ids.map(id => `  ${id.padEnd(24)} ${SUITE_CONFIG[id].label}`).join("\n")}

选项:
  --ci                   CI模式：禁用颜色，简洁输出，严格退出码
  -v, --verbose          显示完整脚本输出
  --json                 JSON格式输出结果（CI集成用）
  -h, --help             显示此帮助

快捷分组:
  all                    运行全部验证（默认）
  quick                  仅运行无服务器的快速检查: ${GROUPS.quick.join(", ")}
  api                    所有需要API服务器的验证: ${GROUPS.api.join(", ")}

示例:
  node scripts/run-verify.js                          # 运行全部
  node scripts/run-verify.js quick                    # 快速本地检查
  node scripts/run-verify.js consistency ledger       # 指定多个
  node scripts/run-verify.js sync,conflict            # 逗号分隔
  node scripts/run-verify.js auth-audit --ci --json   # CI中运行
  npm run verify:auth-audit                           # npm脚本快捷方式
`);
}

function resolveSuites(selected) {
  if (selected.length === 0) return [...SUITES];

  const expanded = new Set();
  for (const sel of selected) {
    if (GROUPS[sel]) {
      for (const id of GROUPS[sel]) expanded.add(id);
    } else {
      expanded.add(sel);
    }
  }

  const ids = [...expanded];
  const resolved = [];
  const unknown = [];

  for (const id of ids) {
    const suite = SUITES.find(s => s.id === id);
    if (suite) resolved.push(suite);
    else unknown.push(id);
  }

  if (unknown.length > 0) {
    console.error(`未知验证类别: ${unknown.join(", ")}`);
    console.error(`可用类别: ${ids.join(", ")}, all, quick, api`);
    process.exit(1);
  }

  return resolved;
}

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

function color(enabled) {
  if (!enabled) {
    return {
      reset: "",
      red: "",
      green: "",
      yellow: "",
      cyan: "",
      gray: "",
      bold: "",
      dim: ""
    };
  }
  return COLORS;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function findFreePort(startPort = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", err => {
      if (err.code === "EADDRINUSE" && startPort > 0) {
        resolve(findFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function prepareIsolatedData(tmpDir) {
  await mkdir(tmpDir, { recursive: true });

  const files = [
    { src: join(DATA_DIR, "lab.json"), dest: join(tmpDir, "lab.json") },
    { src: join(DATA_DIR, "event-ledger.json"), dest: join(tmpDir, "event-ledger.json") },
    { src: join(DATA_DIR, "audit-logs.json"), dest: join(tmpDir, "audit-logs.json") }
  ];

  for (const { src, dest } of files) {
    if (existsSync(src)) {
      await cp(src, dest, { recursive: true });
    }
  }

  return {
    DB_PATH: join(tmpDir, "lab.json"),
    EVENT_LEDGER_PATH: join(tmpDir, "event-ledger.json"),
    AUDIT_LOG_PATH: join(tmpDir, "audit-logs.json"),
    DATA_DIR: tmpDir
  };
}

function startServer(port, envPaths, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timeoutTimer = setTimeout(() => {
      reject(new Error(`server start timeout (${timeoutMs}ms)`));
      try { proc.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    const proc = spawn("node", ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "test",
        ...envPaths
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false
    });

    let stderrBuf = "";
    let stdoutBuf = "";
    proc.stderr.on("data", d => { stderrBuf += d.toString(); });
    proc.stdout.on("data", d => { stdoutBuf += d.toString(); });

    proc.on("exit", code => {
      clearTimeout(timeoutTimer);
      if (code !== 0 && code !== null) {
        reject(new Error(`server exited with code ${code}: ${stderrBuf.slice(0, 500)}`));
      }
    });

    let retries = 0;
    const maxRetries = Math.floor(timeoutMs / 200);

    const tryConnect = async () => {
      retries++;
      try {
        const http = await import("node:http");
        await new Promise((res, rej) => {
          const req = http.request(`http://127.0.0.1:${port}/healthz`, { method: "GET" }, r => {
            r.resume();
            if (r.statusCode === 200) res();
            else rej(new Error(`status ${r.statusCode}`));
          });
          req.on("error", rej);
          req.setTimeout(1000, () => { req.destroy(); rej(new Error("timeout")); });
          req.end();
        });
        clearTimeout(timeoutTimer);
        return resolve(proc);
      } catch {
        if (retries >= maxRetries) {
          clearTimeout(timeoutTimer);
          try { proc.kill("SIGKILL"); } catch {}
          return reject(new Error(
            `server start failed after ${timeoutMs}ms\nstdout: ${stdoutBuf.slice(-300)}\nstderr: ${stderrBuf.slice(-300)}`
          ));
        }
        setTimeout(tryConnect, 200);
      }
    };
    tryConnect();
  });
}

function stopServer(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null) return resolve();

    const forceTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 3000);

    proc.on("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });

    try {
      proc.kill("SIGTERM");
    } catch {
      clearTimeout(forceTimer);
      resolve();
    }
  });
}

async function cleanupDir(tmpDir) {
  try {
    if (existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    }
  } catch {}
}

function runScript(scriptPath, extraEnv = {}, timeoutMs = 120000) {
  return new Promise(resolve => {
    let timedOut = false;
    const proc = spawn("node", [scriptPath], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });

    proc.on("exit", code => {
      clearTimeout(timeoutTimer);
      if (timedOut) {
        resolve({ code: 124, stdout, stderr: `TIMEOUT after ${timeoutMs}ms\n` + stderr });
      } else {
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });

    proc.on("error", err => {
      clearTimeout(timeoutTimer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function extractFailureSummary(stdout, stderr) {
  const allText = stdout + "\n" + stderr;
  const lines = allText.split("\n");
  const failLines = [];
  const apiLines = [];
  const errorLines = [];

  const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, "");

  for (const line of lines) {
    const trimmed = stripAnsi(line).trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    if (upper.includes("FAIL") || upper.includes("FAILED") ||
        upper.includes("ASSERTION FAILED") || upper.includes("ERROR") ||
        trimmed.includes("✗") || trimmed.includes("❌")) {
      failLines.push(trimmed.slice(0, 200));
    }

    if (/(?:GET|POST|PATCH|PUT|DELETE)\s+\/\S+/i.test(trimmed)) {
      apiLines.push(trimmed.slice(0, 200));
    }

    const statusMatch = trimmed.match(/status[=:](\d{3})/);
    if (statusMatch && parseInt(statusMatch[1]) >= 400) {
      failLines.push(trimmed.slice(0, 200));
    }
  }

  const stackStart = allText.indexOf("Error:");
  const stackTrace = stackStart >= 0 ? allText.slice(stackStart, stackStart + 500) : "";

  return {
    failLines: [...new Set(failLines)].slice(0, 20),
    apiLines: [...new Set(apiLines)].slice(0, 10),
    stackTrace
  };
}

async function runSuite(suite, opts) {
  const { ci, verbose, json } = opts;
  const c = color(!ci);
  const runId = randomUUID().slice(0, 8);
  const tmpDir = join(tmpdir(), `verify-${suite.id}-${runId}`);

  let serverProc = null;
  let envPaths = {};
  let port = null;

  const startTime = Date.now();

  if (!json) {
    if (!ci) {
      console.log(`\n${c.cyan}── ${suite.label} (${suite.id}) ──${c.reset}`);
    } else {
      process.stdout.write(`[${suite.id}] running... `);
    }
  }

  try {
    if (verbose && !ci && !json) {
      console.log(`${c.dim}  准备隔离数据目录: ${tmpDir}${c.reset}`);
    }
    envPaths = await prepareIsolatedData(tmpDir);

    if (suite.needsServer) {
      port = await findFreePort();
      if (verbose && !ci && !json) {
        console.log(`${c.dim}  启动验证服务器: 127.0.0.1:${port}${c.reset}`);
      }
      serverProc = await startServer(port, envPaths, 20000);
      if (verbose && !ci && !json) {
        console.log(`${c.dim}  服务器就绪${c.reset}`);
      }
    }

    const scriptEnv = {
      ...envPaths,
      VERIFY_BASE_URL: port ? `http://127.0.0.1:${port}` : "",
      VERIFY_PORT: port ? String(port) : "",
      VERIFY_TMP_DIR: tmpDir,
      VERIFY_MODE: "1"
    };

    const result = await runScript(suite.script, scriptEnv, 120000);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const ok = result.code === 0;

    if (verbose && !json) {
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
    }

    if (!json) {
      if (!ci) {
        if (ok) {
          console.log(`${c.green}  ✓ ${suite.label} 通过${c.reset} ${c.dim}(${elapsed}s)${c.reset}`);
        } else {
          console.log(`${c.red}  ✗ ${suite.label} 失败${c.reset} ${c.dim}(${elapsed}s)${c.reset}`);
          printFailureDetails(result, c, verbose);
        }
      } else {
        if (ok) {
          process.stdout.write(`${c.green}OK${c.reset} ${c.dim}${elapsed}s${c.reset}\n`);
        } else {
          process.stdout.write(`${c.red}FAIL${c.reset} ${c.dim}${elapsed}s${c.reset}\n`);
          printFailureDetails(result, c, verbose);
        }
      }
    }

    return {
      id: suite.id,
      label: suite.label,
      ok,
      elapsed,
      code: result.code,
      script: suite.script,
      stdout: verbose ? result.stdout : undefined,
      stderr: verbose ? result.stderr : undefined,
      summary: ok ? undefined : extractFailureSummary(result.stdout, result.stderr)
    };

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!json) {
      if (!ci) {
        console.log(`${c.red}  ✗ ${suite.label} 环境错误${c.reset}`);
        console.log(`${c.red}    ${err.message.split("\n")[0]}${c.reset}`);
      } else {
        process.stdout.write(`${c.red}ERROR${c.reset} ${c.dim}${elapsed}s${c.reset}\n`);
        console.log(`  ${err.message.split("\n")[0]}`);
      }
    }

    return {
      id: suite.id,
      label: suite.label,
      ok: false,
      elapsed,
      code: 1,
      script: suite.script,
      setupError: err.message
    };
  } finally {
    if (serverProc) {
      if (verbose && !ci && !json) console.log(`${c.dim}  停止验证服务器${c.reset}`);
      await stopServer(serverProc);
    }
    await cleanupDir(tmpDir);
    if (verbose && !ci && !json) console.log(`${c.dim}  隔离数据已清理${c.reset}`);
  }
}

function printFailureDetails(result, c, verbose) {
  if (verbose) return;

  const summary = extractFailureSummary(result.stdout, result.stderr);

  if (summary.failLines.length > 0) {
    console.log(`${c.red}  失败信息:${c.reset}`);
    for (const line of summary.failLines.slice(0, 10)) {
      console.log(`${c.dim}    ${line}${c.reset}`);
    }
    if (summary.failLines.length > 10) {
      console.log(`${c.dim}    ... 还有 ${summary.failLines.length - 10} 项${c.reset}`);
    }
  }

  if (summary.apiLines.length > 0) {
    console.log(`${c.yellow}  涉及接口:${c.reset}`);
    for (const line of summary.apiLines.slice(0, 5)) {
      console.log(`${c.dim}    ${line}${c.reset}`);
    }
  }

  if (result.stderr && result.stderr.trim()) {
    const errLines = result.stderr.trim().split("\n").filter(l => l.trim()).slice(0, 3);
    if (errLines.length > 0 && summary.failLines.length === 0) {
      console.log(`${c.yellow}  错误输出:${c.reset}`);
      for (const line of errLines) {
        console.log(`${c.dim}    ${line.slice(0, 120)}${c.reset}`);
      }
    }
  }

  if (summary.stackTrace) {
    console.log(`${c.dim}  堆栈摘要:${c.reset}`);
    const stackLines = summary.stackTrace.split("\n").slice(0, 3);
    for (const line of stackLines) {
      console.log(`${c.dim}    ${line.trim().slice(0, 120)}${c.reset}`);
    }
  }
}

function printSummary(results, opts) {
  const { ci, json } = opts;
  const c = color(!ci);

  if (json) {
    const totalElapsed = results.reduce((s, r) => s + parseFloat(r.elapsed), 0).toFixed(1);
    const out = {
      total: results.length,
      passed: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      elapsed: totalElapsed,
      results: results.map(r => ({
        id: r.id,
        label: r.label,
        ok: r.ok,
        elapsed: r.elapsed,
        code: r.code,
        ...(r.setupError ? { error: r.setupError } : {}),
        ...(r.summary ? { summary: r.summary } : {})
      }))
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const totalElapsed = results.reduce((s, r) => s + parseFloat(r.elapsed), 0).toFixed(1);
  const passed = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  console.log(`\n${c.bold}${c.cyan}── 验证汇总 ──${c.reset}`);

  for (const r of results) {
    const icon = r.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const status = r.ok ? "通过" : (r.setupError ? "错误" : "失败");
    console.log(`  ${icon} ${r.label.padEnd(22)} ${c.dim}${r.elapsed.padStart(5)}s${c.reset} ${r.ok ? c.green : c.red}${status}${c.reset}`);
  }

  console.log("");
  console.log(
    `  总计: ${results.length}  ` +
    `${c.green}通过: ${passed.length}${c.reset}  ` +
    `${c.red}失败: ${failed.length}${c.reset}  ` +
    `${c.dim}耗时: ${totalElapsed}s${c.reset}`
  );

  if (failed.length > 0) {
    console.log(`\n${c.red}${c.bold}失败详情:${c.reset}`);
    for (const r of failed) {
      console.log(`${c.red}  ✗ ${r.label} (${r.id})${c.reset}`);
      console.log(`${c.dim}    脚本: ${r.script}${c.reset}`);
      if (r.setupError) {
        console.log(`${c.yellow}    环境错误: ${r.setupError.split("\n")[0]}${c.reset}`);
      } else {
        console.log(`${c.dim}    退出码: ${r.code}${c.reset}`);
      }
      console.log(`${c.dim}    单独重跑: node scripts/run-verify.js ${r.id} -v${c.reset}`);
    }
    console.log("");
  } else {
    console.log(`\n${c.green}${c.bold}全部通过 ✓${c.reset}\n`);
  }
}

let activeResources = [];

function registerResource(cleanupFn) {
  activeResources.push(cleanupFn);
}

async function cleanupAll() {
  for (const cleanup of activeResources) {
    try { await cleanup(); } catch {}
  }
  activeResources = [];
}

function setupSignalHandlers() {
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const sig of signals) {
    process.on(sig, async () => {
      console.log(`\n收到 ${sig}，正在清理资源...`);
      await cleanupAll();
      process.exit(130);
    });
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const suites = resolveSuites(opts.selected);
  const c = color(!opts.ci);

  setupSignalHandlers();

  if (!opts.json) {
    if (!opts.ci) {
      console.log(`${c.bold}${c.cyan}实验动物房 - 统一验证入口${c.reset}`);
      console.log(`${c.dim}运行 ${suites.length} 个验证: ${suites.map(s => s.id).join(", ")}${c.reset}`);
      console.log(`${c.dim}模式: ${opts.ci ? "CI" : "本地"} ${opts.verbose ? "| 详细输出" : ""}${c.reset}`);
    } else if (!opts.json) {
      console.log(`验证入口: ${suites.length} suites, CI mode`);
    }
  }

  const results = [];
  let hasFailure = false;

  for (const suite of suites) {
    const result = await runSuite(suite, opts);
    results.push(result);
    if (!result.ok) hasFailure = true;
  }

  printSummary(results, opts);

  if (hasFailure) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

process.on("uncaughtException", async err => {
  console.error("Fatal uncaughtException:", err.message);
  await cleanupAll();
  process.exit(2);
});

process.on("unhandledRejection", async err => {
  console.error("Fatal unhandledRejection:", err?.message || err);
  await cleanupAll();
  process.exit(2);
});

main().catch(async err => {
  console.error("Fatal:", err);
  await cleanupAll();
  process.exit(2);
});
