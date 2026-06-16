import { send, body } from "../lib/helpers.js";
import {
  runConsistencyCheck,
  filterResult,
  SEVERITY,
  ISSUE_CATEGORIES,
  CATEGORY_LABELS
} from "../lib/dataConsistency.js";
import { verifyIntegrity, verifySnapshotConsistency } from "../lib/eventLedger.js";

export async function handleAdminRoutes(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/admin/consistency/check") {
    await handleConsistencyCheck(req, res, url, db);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/consistency/repair-preview") {
    await handleRepairPreview(req, res, url, db);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/consistency/summary") {
    await handleConsistencySummary(req, res, url, db);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/consistency/categories") {
    handleListCategories(req, res);
    return true;
  }

  return false;
}

async function handleConsistencyCheck(req, res, url, db) {
  const checksParam = url.searchParams.get("checks");
  const category = url.searchParams.get("category");
  const severity = url.searchParams.get("severity");
  const format = url.searchParams.get("format") || "full";

  const options = {};
  if (checksParam) {
    options.checks = checksParam.split(",").map(s => s.trim()).filter(Boolean);
  }

  try {
    const result = await runConsistencyCheck(options);

    let filteredResult = result;
    if (category || severity) {
      filteredResult = filterResult(result, { category, severity });
    }

    if (format === "summary") {
      send(res, 200, buildSummaryResponse(filteredResult));
    } else {
      send(res, 200, filteredResult);
    }
  } catch (error) {
    send(res, 500, {
      error: "consistency_check_failed",
      message: error.message
    });
  }
}

async function handleRepairPreview(req, res, url, db) {
  const checksParam = url.searchParams.get("checks");
  const category = url.searchParams.get("category");
  const severity = url.searchParams.get("severity");

  const options = {};
  if (checksParam) {
    options.checks = checksParam.split(",").map(s => s.trim()).filter(Boolean);
  }

  try {
    const result = await runConsistencyCheck(options);

    let filteredResult = result;
    if (category || severity) {
      filteredResult = filterResult(result, { category, severity });
    }

    const repairableIssues = filteredResult.issues.filter(i => i.repairable);

    const response = {
      dryRun: true,
      timestamp: filteredResult.timestamp,
      totalPatches: repairableIssues.length,
      totalIssues: filteredResult.summary.total,
      riskSummary: filteredResult.repairPreview.riskSummary,
      patches: repairableIssues.map(issue => ({
        id: `${issue.type}-${issue.entityId || issue.index || 'x'}`,
        type: issue.type,
        category: issue.category,
        categoryLabel: CATEGORY_LABELS[issue.category] || issue.category,
        severity: issue.severity,
        entityType: issue.entityType,
        entityId: issue.entityId,
        field: issue.field,
        expected: issue.expected,
        actual: issue.actual,
        message: issue.message,
        patch: issue.repairPatch,
        risk: issue.repairRisk,
        metadata: issue.metadata
      }))
    };

    send(res, 200, response);
  } catch (error) {
    send(res, 500, {
      error: "repair_preview_failed",
      message: error.message
    });
  }
}

async function handleConsistencySummary(req, res, url, db) {
  try {
    const result = await runConsistencyCheck();

    const response = {
      timestamp: result.timestamp,
      overall: {
        totalIssues: result.summary.total,
        repairable: result.summary.repairable,
        bySeverity: result.summary.bySeverity,
        byCategory: result.summary.byCategory
      },
      checkResults: {},
      riskAssessment: result.repairPreview.riskSummary
    };

    for (const [name, check] of Object.entries(result.checkResults)) {
      const bySeverity = {};
      for (const issue of check.issues) {
        bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      }
      response.checkResults[name] = {
        count: check.count,
        bySeverity,
        repairableCount: check.issues.filter(i => i.repairable).length
      };
    }

    send(res, 200, response);
  } catch (error) {
    send(res, 500, {
      error: "summary_check_failed",
      message: error.message
    });
  }
}

function handleListCategories(req, res) {
  const categories = Object.entries(ISSUE_CATEGORIES).map(([key, value]) => ({
    key,
    value,
    label: CATEGORY_LABELS[value] || value
  }));

  const severities = Object.entries(SEVERITY).map(([key, value]) => ({
    key,
    value
  }));

  const checkTypes = [
    { key: "facility", label: "设施归属与笼位一致性" },
    { key: "breeding", label: "繁育关系与断奶子代" },
    { key: "health", label: "健康事件关联" },
    { key: "ledger", label: "账本校验和链" },
    { key: "audit", label: "审计日志 animalIds" },
    { key: "snapshot_ledger", label: "快照与账本一致性" }
  ];

  send(res, 200, { categories, severities, checkTypes });
}

function buildSummaryResponse(result) {
  return {
    dryRun: result.dryRun,
    timestamp: result.timestamp,
    summary: result.summary,
    repairPreview: {
      totalPatches: result.repairPreview.totalPatches,
      riskSummary: result.repairPreview.riskSummary
    },
    checkResults: Object.fromEntries(
      Object.entries(result.checkResults).map(([k, v]) => [k, { count: v.count }])
    )
  };
}
