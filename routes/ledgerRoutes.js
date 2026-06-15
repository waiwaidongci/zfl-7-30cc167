import { send } from "../lib/helpers.js";
import {
  getLedgerInfo,
  queryEvents,
  getEventById,
  replayAnimalLifecycle,
  replayRoomTimeline,
  replayProjectTimeline,
  exportEventsByTimeRange,
  verifyIntegrity,
  verifySnapshotConsistency,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  isAnimalRelatedEvent
} from "../lib/eventLedger.js";
import { migrateFromSnapshot } from "../scripts/migrate-events.js";

export async function handleLedgerRoutes(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/ledger/info") {
    const info = await getLedgerInfo();
    send(res, 200, info);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/ledger/event-types") {
    const types = Object.entries(EVENT_TYPES).map(([key, value]) => ({
      key,
      value,
      label: EVENT_TYPE_LABELS[value] || value,
      animalRelated: isAnimalRelatedEvent(value)
    }));
    send(res, 200, types);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/ledger/events") {
    const eventTypes = url.searchParams.getAll("eventType").filter(Boolean);
    const filters = {
      eventType: eventTypes.length > 1 ? eventTypes : (eventTypes[0] || undefined),
      animalId: url.searchParams.get("animalId") || undefined,
      roomId: url.searchParams.get("roomId") || undefined,
      zoneId: url.searchParams.get("zoneId") || undefined,
      projectId: url.searchParams.get("projectId") || undefined,
      operatorName: url.searchParams.get("operatorName") || undefined,
      operatorRole: url.searchParams.get("operatorRole") || undefined,
      fromDate: url.searchParams.get("fromDate") || undefined,
      toDate: url.searchParams.get("toDate") || undefined,
      sort: url.searchParams.get("sort") || "desc",
      limit: url.searchParams.get("limit") || 100,
      offset: url.searchParams.get("offset") || 0
    };

    const animalRelated = url.searchParams.get("animalRelated");
    if (animalRelated === "true") filters.animalRelated = true;
    if (animalRelated === "false") filters.animalRelated = false;

    const includeNullFacility = url.searchParams.get("includeNullFacility");
    if (includeNullFacility === "true") filters.includeNullFacility = true;

    const result = await queryEvents(filters);
    send(res, 200, result);
    return true;
  }

  const eventMatch = url.pathname.match(/^\/ledger\/events\/([^/]+)$/);
  if (eventMatch && req.method === "GET") {
    const event = await getEventById(eventMatch[1]);
    if (!event) {
      send(res, 404, { error: "event_not_found" });
      return true;
    }
    send(res, 200, event);
    return true;
  }

  const lifecycleMatch = url.pathname.match(/^\/ledger\/animals\/([^/]+)\/lifecycle$/);
  if (lifecycleMatch && req.method === "GET") {
    const animalId = lifecycleMatch[1];
    const options = {};
    const until = url.searchParams.get("until");
    if (until) options.until = until;

    const result = await replayAnimalLifecycle(animalId, options);
    if (!result.found) {
      send(res, 404, { error: "animal_not_found_in_ledger", animalId });
      return true;
    }
    send(res, 200, result);
    return true;
  }

  const roomTimelineMatch = url.pathname.match(/^\/ledger\/rooms\/([^/]+)\/timeline$/);
  if (roomTimelineMatch && req.method === "GET") {
    const roomId = roomTimelineMatch[1];
    const options = {};
    const until = url.searchParams.get("until");
    if (until) options.until = until;
    const from = url.searchParams.get("from");
    if (from) options.from = from;
    const animalRelated = url.searchParams.get("animalRelated");
    if (animalRelated === "true") options.animalRelated = true;

    const result = await replayRoomTimeline(roomId, options);
    if (!result.found) {
      send(res, 404, { error: "room_not_found_in_ledger", roomId });
      return true;
    }
    send(res, 200, result);
    return true;
  }

  const projectTimelineMatch = url.pathname.match(/^\/ledger\/projects\/([^/]+)\/timeline$/);
  if (projectTimelineMatch && req.method === "GET") {
    const projectId = projectTimelineMatch[1];
    const options = {};
    const until = url.searchParams.get("until");
    if (until) options.until = until;
    const from = url.searchParams.get("from");
    if (from) options.from = from;
    const animalRelated = url.searchParams.get("animalRelated");
    if (animalRelated === "true") options.animalRelated = true;

    const result = await replayProjectTimeline(projectId, options);
    if (!result.found) {
      send(res, 404, { error: "project_not_found_in_ledger", projectId });
      return true;
    }
    send(res, 200, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/ledger/export") {
    const fromDate = url.searchParams.get("fromDate");
    const toDate = url.searchParams.get("toDate");
    const format = url.searchParams.get("format") || "json";

    if (!fromDate || !toDate) {
      send(res, 400, {
        error: "missing_parameters",
        message: "fromDate 和 toDate 参数是必需的"
      });
      return true;
    }

    const options = { format };
    const animalId = url.searchParams.get("animalId");
    if (animalId) options.animalId = animalId;

    const roomId = url.searchParams.get("roomId");
    if (roomId) options.roomId = roomId;

    const zoneId = url.searchParams.get("zoneId");
    if (zoneId) options.zoneId = zoneId;

    const projectId = url.searchParams.get("projectId");
    if (projectId) options.projectId = projectId;

    const eventTypes = url.searchParams.get("eventTypes");
    if (eventTypes) {
      options.eventTypes = eventTypes.split(",").map(t => t.trim()).filter(Boolean);
    }

    const animalRelated = url.searchParams.get("animalRelated");
    if (animalRelated === "true") options.animalRelated = true;
    if (animalRelated === "false") options.animalRelated = false;

    const result = await exportEventsByTimeRange(fromDate, toDate, options);

    if (format === "csv") {
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ledger-export-${fromDate}-${toDate}.csv"`
      });
      res.end(result.content);
    } else {
      send(res, 200, result);
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/ledger/verify/integrity") {
    const result = await verifyIntegrity();
    send(res, 200, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/ledger/verify/snapshot") {
    const result = await verifySnapshotConsistency(db);
    send(res, 200, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/ledger/migrate") {
    const force = url.searchParams.get("force") === "true";
    try {
      const result = await migrateFromSnapshot({
        force,
        operator: req._principal || { role: "system", name: "api_migration", key: "system" }
      });
      send(res, 200, result);
    } catch (error) {
      send(res, 500, { error: "migration_failed", message: error.message });
    }
    return true;
  }

  return false;
}
