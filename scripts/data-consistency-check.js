import { runConsistencyCheck, formatConsoleReport, filterResult, ISSUE_CATEGORIES, SEVERITY } from "../lib/dataConsistency.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    format: "console",
    checks: null,
    category: null,
    severity: null,
    output: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--format":
      case "-f":
        options.format = args[++i] || "console";
        break;
      case "--checks":
      case "-c":
        options.checks = args[++i]?.split(",").map(s => s.trim()).filter(Boolean) || null;
        break;
      case "--category":
        options.category = args[++i] || null;
        break;
      case "--severity":
      case "-s":
        options.severity = args[++i] || null;
        break;
      case "--output":
      case "-o":
        options.output = args[++i] || null;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--json":
        options.format = "json";
        break;
      case "--summary":
        options.format = "summary";
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
数据一致性巡检脚本 (Dry Run 模式)

用法:
  node scripts/data-consistency-check.js [选项]

选项:
  -f, --format <格式>      输出格式: console (默认), json, summary
  -c, --checks <检查项>    指定要运行的检查项，逗号分隔
                           可用: facility, breeding, health, ledger, audit, snapshot_ledger
  --category <类别>        仅显示指定类别的问题
  -s, --severity <级别>    仅显示指定严重程度及以上的问题
                           可用: critical, error, warning, info
  -o, --output <文件>      将 JSON 结果输出到文件
  --json                   等价于 --format json
  --summary                仅输出摘要
  -h, --help               显示此帮助

示例:
  # 运行全部检查，控制台输出
  node scripts/data-consistency-check.js

  # 仅检查设施和繁育
  node scripts/data-consistency-check.js -c facility,breeding

  # 输出 JSON 格式
  node scripts/data-consistency-check.js --json

  # 仅显示 error 及以上级别问题
  node scripts/data-consistency-check.js -s error

  # 输出到文件
  node scripts/data-consistency-check.js --json -o report.json
`);
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    const checkOptions = {};
    if (options.checks && options.checks.length > 0) {
      checkOptions.checks = options.checks;
    }

    let result = await runConsistencyCheck(checkOptions);

    if (options.category || options.severity) {
      result = filterResult(result, options);
    }

    switch (options.format) {
      case "json":
        console.log(JSON.stringify(result, null, 2));
        break;
      case "summary":
        printSummary(result);
        break;
      case "console":
      default:
        console.log(formatConsoleReport(result));
        break;
    }

    if (options.output && options.format !== "json") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(options.output, JSON.stringify(result, null, 2));
      console.log(`\n完整 JSON 报告已保存到: ${options.output}`);
    } else if (options.output) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(options.output, JSON.stringify(result, null, 2));
    }

    const hasCritical = result.summary.bySeverity.critical > 0;
    const hasError = result.summary.bySeverity.error > 0;
    if (hasCritical || hasError) {
      process.exit(hasCritical ? 2 : 1);
    }
  } catch (error) {
    console.error("巡检执行失败:", error.message);
    console.error(error.stack);
    process.exit(3);
  }
}

function printSummary(result) {
  const { summary, repairPreview } = result;
  console.log("数据一致性巡检摘要");
  console.log("=".repeat(50));
  console.log(`问题总数: ${summary.total}`);
  console.log(`可自动修复: ${summary.repairable}`);
  console.log("");

  console.log("严重程度:");
  const sevLabels = { critical: "严重", error: "错误", warning: "警告", info: "信息" };
  for (const [sev, label] of Object.entries(sevLabels)) {
    const count = summary.bySeverity[sev] || 0;
    console.log(`  ${label}: ${count}`);
  }
  console.log("");

  console.log("类别分布:");
  const catLabels = {
    facility_consistency: "设施归属一致性",
    cage_ownership: "笼位归属一致性",
    breeding_relations: "繁育父母关系",
    weaning_offspring: "断奶子代关联",
    health_event_reference: "健康事件关联",
    ledger_checksum: "账本校验和链",
    audit_animal_ids: "审计 animalIds",
    snapshot_ledger: "快照与账本一致性"
  };
  for (const [cat, count] of Object.entries(summary.byCategory)) {
    console.log(`  ${catLabels[cat] || cat}: ${count}`);
  }
  console.log("");

  const riskLabels = { low: "低风险", medium: "中风险", high: "高风险", none: "无", unknown: "未知" };
  console.log(`修复风险: ${riskLabels[repairPreview.riskSummary.overallAssessment] || "未知"}`);
  console.log(`补丁数量: ${repairPreview.totalPatches}`);
}

main();
