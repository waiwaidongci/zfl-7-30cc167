#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "data");

const SUITES = [
  {
    id: "auth-audit",
    label: "API权限与审计验证",
    script: join(ROOT, "scripts", "test-auth-audit.js"),
    serverMode: "self",
    category: "认证审计"
  },
  {
    id: "ledger",
    label: "事件台账校验",
    script: join(ROOT, "scripts", "test-ledger.js"),
    serverMode: "none",
    category: "事件台账"
  },
  {
    id: "consistency",
    label: "数据一致性巡检",
    script: join(ROOT, "scripts", "data-consistency-check.js"),
    serverMode: "none",
    category: "数据一致性"
  },
  {
    id: "sync",
    label: "离线同步验证",
    script: join(ROOT, "scripts", "test-offline-sync.js"),
    serverMode: "runner",
    category: "离线同步"
  },
  {
    id: "conflict",
    label: "冲突队列验证",
    script: join(ROOT, "scripts", "test-conflict-queue.js"),
    serverMode: "runner",
    category: "离线同步"
  },
  {
    id: "conflict-regression",
    label: "冲突队列回归测试",
    script: join(ROOT, "scripts", "test-conflict-queue-regression.js"),
    serverMode: "self",
    category: "离线同步"
  },
  {
    id: "batch-import",
    label: "批量导入验证",
    script: join(ROOT, "scripts", "test-batch-import.js"),
    serverMode: "self",
    category: "批量导入"
  },
  {
    id: "feeding",
    label: "饲喂日程验证",
    script: join(ROOT, "scripts", "test-feeding-schedule.js"),
    serverMode: "none",
    category: "饲喂日程"
  },
  {
    id: "room-pressure",
    label: "房间压力看板验证",
    script: join(ROOT, "scripts", "test-room-pressure-dashboard.js"),
    serverMode: "self",
    category: "设施看板"
  }
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const selected = [];
  let ci = false;
  let verbose = false;

  for (const arg of args) {
    if (arg === "--ci") { ci = true; continue; }
    if (arg === "--verbose" || arg === "-v") { verbose = true; continue; }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    for (const part of arg.split(",")) {
      const trimmed = part.trim();
      if (trimmed) selected.push(trimmed);
    }
  }

  return { selected, ci, verbose };
}

function printHelp() {
  console.log(`
验证入口 - 统一运行分散的测试/巡检/校验脚本

用法:
  node scripts/run-verify.js [类别...] [选项]

类别:
${SUITES.map(s => `  ${s.id.padEnd(24)} ${s.label}`).join("\n")}

选项:
  --ci                   CI模式：禁用颜色，严格退出码
  -v, --verbose          显示完整输出
  -h, --help             显示此帮助

快捷分组:
  all                    运行全部验证（默认）
  quick                  仅运行无服务器的快速检查: consistency, ledger, feeding
  api                    所有需要API服务器的验证: auth-audit, sync, conflict, conflict-regression, batch-import, room-pressure

示例:
  node scripts/run-verify.js                          # 运行全部
  node scripts/run-verify.js quick                    # 快速本地检查
  node scripts/run-verify.js consistency ledger       # 指定多个
  node scripts/run-verify.js sync,conflict            # 逗号分隔
  node scripts/run-verify.js auth-audit --ci          # CI中运行
  npm run verify:auth-audit                           # npm脚本快捷方式
`);
}

function resolveSuites(selected) {
  if (selected.length === 0) return SUITES;

  const groups = {
    all: SUITES.map(s => s.id),
    quick: ["consistency", "ledger", "feeding"],
    api: ["auth-audit", "sync", "conflict", "conflict-regression", "batch-import", "room-pressure"]
  };

  const expanded = new Set();
  for (const sel of selected) {
    if (groups[sel]) {
      for (const id of groups[sel]) expanded.add(id);
    } else {
      expanded.add(sel);
    }
  }

  const ids = [...expanded];
  const resolved = [];
  const unknown = [];

  for (const id of ids) {
    const suite = SUITES.find(s => s.id === id);
    if (suite) {
      resolved.push(suite);
    } else {
      unknown.push(id);
    }
  }

  if (unknown.length > 0) {
    console.error(`未知验证类别: ${unknown.join(", ")}`);
    console.error(`可用类别: ${SUITES.map(s => s.id).join(", ")}, all, quick, api`);
    process.exit(1);
  }

  return resolved;
}

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m"
};

function color(enabled) {
  if (!enabled) {
    const nope = () => "";
    nope.bold = nope;
    nope.dim = nope;
    return { reset: "", red: "", green: "", yellow: "", cyan: "", bold: nope, dim: nope };
  }
  return C;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
      await cp(src, dest);
    }
  }

  return {
    DB_PATH: join(tmpDir, "lab.json"),
    EVENT_LEDGER_PATH: join(tmpDir, "event-ledger.json"),
    AUDIT_LOG_PATH: join(tmpDir, "audit-logs.json")
  };
}

function startServer(port, envPaths) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        ...envPaths
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderrBuf = "";
    proc.stderr.on("data", d => { stderrBuf += d.toString(); });
    proc.stdout.on("data", () => {});

    proc.on("exit", code => {
      if (code !== 0 && code !== null) {
        reject(new Error(`server exit ${code}: ${stderrBuf.slice(0, 500)}`));
      }
    });

    const start = Date.now();
    const tryConnect = async () => {
      try {
        const http = await import("node:http");
        await new Promise((res, rej) => {
          const req = http.request(`http://localhost:${port}/healthz`, { method: "GET" }, r => {
            r.resume();
            if (r.statusCode === 200) res();
            else rej(new Error(`status ${r.statusCode}`));
          });
          req.on("error", rej);
          req.setTimeout(2000, () => { req.destroy(); rej(new Error("timeout")); });
          req.end();
        });
        return resolve(proc);
      } catch {}
      if (Date.now() - start > 20000) {
        proc.kill("SIGKILL");
        return reject(new Error(`server start timeout (20s): ${stderrBuf.slice(0, 500)}`));
      }
      await sleep(300);
      tryConnect();
    };
    tryConnect();
  });
}

function stopServer(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.kill("SIGTERM");
    const forceTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 5000);
    proc.on("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });
  });
}

async function cleanupDir(tmpDir) {
  try {
    if (existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  } catch {}
}

function runScript(scriptPath, extraEnv = {}) {
  return new Promise(resolve => {
    const proc = spawn("node", [scriptPath], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });

    proc.on("exit", code => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    proc.on("error", err => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function extractFailureSummary(stdout, stderr) {
  const lines = (stdout + "\n" + stderr).split("\n");
  const failLines = [];
  const apiLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes("FAIL") || trimmed.includes("✗") || trimmed.includes("❌") ||
        trimmed.includes("FAILED") || trimmed.includes("ASSERTION FAILED")) {
      failLines.push(trimmed);
    }

    if (/(?:GET|POST|PATCH|PUT|DELETE)\s+\/\S+/i.test(trimmed)) {
      apiLines.push(trimmed);
    }

    if (/status=\d{3}/.test(trimmed)) {
      const match = trimmed.match(/status[=:](\d{3})/);
      if (match && parseInt(match[1]) >= 400) {
        failLines.push(trimmed);
      }
    }
  }

  const uniqueFails = [...new Set(failLines)];
  const uniqueApis = [...new Set(apiLines)];

  return { failLines: uniqueFails, apiLines: uniqueApis };
}

async function runSuite(suite, opts) {
  const { ci, verbose } = opts;
  const c = color(!ci);

  console.log(`\n${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ${suite.label}${c.reset}  ${c.dim}(${suite.id})${c.reset}`);
  console.log(`${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);

  const startTime = Date.now();

  if (suite.serverMode === "runner") {
    return await runWithRunnerServer(suite, opts, startTime);
  }

  const result = await runScript(suite.script);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (verbose) {
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
  }

  const ok = result.code === 0;

  if (ok) {
    console.log(`${c.green}  ✓ ${suite.label} 通过${c.reset} ${c.dim}(${elapsed}s)${c.reset}`);
  } else {
    console.log(`${c.red}  ✗ ${suite.label} 失败${c.reset} ${c.dim}(${elapsed}s)${c.reset}`);

    if (!verbose) {
      const summary = extractFailureSummary(result.stdout, result.stderr);
      if (summary.failLines.length > 0) {
        console.log(`${c.red}  失败项:${c.reset}`);
        for (const line of summary.failLines.slice(0, 15)) {
          console.log(`${c.red}    ${line}${c.reset}`);
        }
        if (summary.failLines.length > 15) {
          console.log(`${c.dim}    ... 还有 ${summary.failLines.length - 15} 项${c.reset}`);
        }
      }
      if (summary.apiLines.length > 0) {
        console.log(`${c.yellow}  涉及接口:${c.reset}`);
        for (const line of [...new Set(summary.apiLines)].slice(0, 8)) {
          console.log(`${c.dim}    ${line}${c.reset}`);
        }
      }

      const tailLines = result.stdout.split("\n").filter(l => l.trim()).slice(-5);
      if (tailLines.length > 0 && summary.failLines.length === 0) {
        console.log(`${c.dim}  末尾输出:${c.reset}`);
        for (const line of tailLines) {
          console.log(`${c.dim}    ${line.trim()}${c.reset}`);
        }
      }
    }

    if (result.stderr && result.stderr.trim()) {
      const errLines = result.stderr.trim().split("\n").slice(0, 5);
      console.log(`${c.yellow}  错误输出:${c.reset}`);
      for (const line of errLines) {
        console.log(`${c.yellow}    ${line}${c.reset}`);
      }
    }
  }

  return {
    id: suite.id,
    label: suite.label,
    ok,
    elapsed,
    code: result.code,
    script: suite.script
  };
}

async function runWithRunnerServer(suite, opts, startTime) {
  const { ci, verbose } = opts;
  const c = color(!ci);

  const runId = randomUUID().slice(0, 8);
  const portBase = 31000 + (Math.floor(Math.random() * 1000) * 2);
  const serverPort = portBase;
  const tmpDir = join(tmpdir(), `verify-${suite.id}-${runId}`);

  let serverProc = null;

  try {
    console.log(`${c.dim}  准备隔离数据: ${tmpDir}${c.reset}`);
    const envPaths = await prepareIsolatedData(tmpDir);

    console.log(`${c.dim}  启动验证服务器: :${serverPort}${c.reset}`);
    serverProc = await startServer(serverPort, envPaths);
    await sleep(300);

    const baseUrl = `http://localhost:${serverPort}`;
    console.log(`${c.dim}  服务器就绪: ${baseUrl}${c.reset}`);

    const result = await runScript(suite.script, {
      VERIFY_BASE_URL: baseUrl,
      VERIFY_PORT: String(serverPort)
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const ok = result.code === 0;

    if (verbose) {
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
    }

    if (ok) {
      console.log(`${c.green}  ✓ ${suite.label} 通过${c.reset} ${c.dim}(${elapsed}s)${c.reset}`);
    } else {
      console.log(`${c.red}  ✗ ${suite.label} 失败${c.reset} ${c.dim}(${elapsed}s)${c.reset}`);

      if (!verbose) {
        const summary = extractFailureSummary(result.stdout, result.stderr);
        if (summary.failLines.length > 0) {
          console.log(`${c.red}  失败项:${c.reset}`);
          for (const line of summary.failLines.slice(0, 15)) {
            console.log(`${c.red}    ${line}${c.reset}`);
          }
        }
        if (summary.apiLines.length > 0) {
          console.log(`${c.yellow}  涉及接口:${c.reset}`);
          for (const line of [...new Set(summary.apiLines)].slice(0, 8)) {
            console.log(`${c.dim}    ${line}${c.reset}`);
          }
        }

        const tailLines = result.stdout.split("\n").filter(l => l.trim()).slice(-5);
        if (tailLines.length > 0 && summary.failLines.length === 0) {
          console.log(`${c.dim}  末尾输出:${c.reset}`);
          for (const line of tailLines) {
            console.log(`${c.dim}    ${line.trim()}${c.reset}`);
          }
        }
      }

      if (result.stderr && result.stderr.trim()) {
        const errLines = result.stderr.trim().split("\n").slice(0, 5);
        console.log(`${c.yellow}  错误输出:${c.reset}`);
        for (const line of errLines) {
          console.log(`${c.yellow}    ${line}${c.reset}`);
        }
      }
    }

    return {
      id: suite.id,
      label: suite.label,
      ok,
      elapsed,
      code: result.code,
      script: suite.script
    };

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`${c.red}  ✗ ${suite.label} 环境启动失败${c.reset}`);
    console.log(`${c.red}    ${err.message}${c.reset}`);
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
      console.log(`${c.dim}  停止验证服务器${c.reset}`);
      await stopServer(serverProc);
    }
    await cleanupDir(tmpDir);
    console.log(`${c.dim}  隔离数据已清理${c.reset}`);
  }
}

async function main() {
  const { selected, ci, verbose } = parseArgs(process.argv);
  const suites = resolveSuites(selected);
  const c = color(!ci);

  console.log(`${c.bold}${c.cyan}`);
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║           实验动物房 - 统一验证入口                      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`${c.reset}`);

  console.log(`  运行 ${suites.length} 个验证类别: ${suites.map(s => s.id).join(", ")}`);
  console.log(`  模式: ${ci ? "CI" : "本地"} ${verbose ? "详细" : "标准"}`);
  console.log(`  项目根: ${ROOT}`);

  const globalStart = Date.now();
  const results = [];

  for (const suite of suites) {
    const result = await runSuite(suite, { ci, verbose });
    results.push(result);
  }

  const totalElapsed = ((Date.now() - globalStart) / 1000).toFixed(1);

  console.log(`\n${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.bold}  验证汇总${c.reset}`);
  console.log(`${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);

  const passed = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  for (const r of results) {
    const icon = r.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const time = `${c.dim}(${r.elapsed}s)${c.reset}`;
    console.log(`  ${icon} ${r.label.padEnd(20)} ${time}`);
  }

  console.log("");
  console.log(`  通过: ${c.green}${passed.length}${c.reset}  失败: ${failed.length > 0 ? c.red : ""}${failed.length}${c.reset}  总计: ${results.length}  耗时: ${totalElapsed}s`);

  if (failed.length > 0) {
    console.log(`\n${c.red}${c.bold}  失败详情:${c.reset}`);
    for (const r of failed) {
      console.log(`${c.red}  ✗ ${r.label}${c.reset}`);
      console.log(`${c.dim}    脚本: ${r.script}${c.reset}`);
      if (r.setupError) {
        console.log(`${c.yellow}    环境错误: ${r.setupError}${c.reset}`);
      }
      console.log(`${c.dim}    退出码: ${r.code}${c.reset}`);
      console.log(`${c.dim}    单独重跑: node ${r.script}${c.reset}`);
      console.log("");
    }

    if (ci) {
      console.log(`${c.red}CI验证失败，退出码 1${c.reset}`);
      process.exit(1);
    } else {
      console.log(`${c.yellow}提示: 使用 -v 查看完整输出，或单独运行失败脚本调试${c.reset}`);
      process.exit(1);
    }
  } else {
    console.log(`\n${c.green}${c.bold}  全部通过! 🎉${c.reset}`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(2);
});
