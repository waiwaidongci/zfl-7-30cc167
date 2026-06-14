import { send } from "../lib/helpers.js";
import { queryAuditLogs, getAuditLogById, getAuditStats, getAuditOperations } from "../lib/audit.js";

export async function handleAuditRoutes(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/audit/logs") {
    await handleListLogs(req, res, url);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/audit/stats") {
    await handleStats(req, res, url);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/audit/operations") {
    send(res, 200, { operations: getAuditOperations() });
    return true;
  }

  const detailMatch = url.pathname.match(/^\/audit\/logs\/([^/]+)$/);
  if (detailMatch && req.method === "GET") {
    const id = detailMatch[1];
    const log = await getAuditLogById(id);
    if (!log) {
      send(res, 404, { error: "audit_log_not_found", id });
      return true;
    }
    send(res, 200, log);
    return true;
  }

  return false;
}

async function handleListLogs(req, res, url) {
  const filters = {
    animalId: url.searchParams.get("animalId"),
    operatorKey: url.searchParams.get("operatorKey"),
    operatorName: url.searchParams.get("operatorName"),
    role: url.searchParams.get("role"),
    operation: url.searchParams.get("operation"),
    method: url.searchParams.get("method"),
    fromDate: url.searchParams.get("fromDate"),
    toDate: url.searchParams.get("toDate"),
    statusCode: url.searchParams.get("statusCode"),
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset")
  };

  const result = await queryAuditLogs(filters);
  send(res, 200, result);
}

async function handleStats(req, res, url) {
  const filters = {
    fromDate: url.searchParams.get("fromDate"),
    toDate: url.searchParams.get("toDate")
  };
  const stats = await getAuditStats(filters);
  send(res, 200, stats);
}
