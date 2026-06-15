import { send } from "../lib/helpers.js";
import {
  listRooms,
  getRoom,
  addRoom,
  updateRoom,
  listZones,
  getZone,
  addZone,
  listProjects,
  getProject,
  addProject,
  updateProject,
  listKeepers,
  getKeeper,
  addKeeper,
  updateKeeper,
  getFacilityOverview,
  getRoomPressureDashboard,
  DEFAULT_ROOM_ID,
  DEFAULT_ZONE_ID,
  DEFAULT_PROJECT_ID,
  resolveRoomIdByCage
} from "../lib/facilityData.js";
import { validateRoomAccess, validateProjectAccess } from "../lib/permissions.js";
import { assertRole } from "../lib/auth.js";
import { ROLES } from "../lib/apiKeys.js";

export async function facilityRoutes(req, res, url, db) {
  const principal = req._principal;
  const method = req.method;
  const readQuery = (key) => url.searchParams.get(key);

  if (url.pathname === "/facility/overview" && method === "GET") {
    const overview = getFacilityOverview(db);
    if (principal?.role !== ROLES.ADMIN) {
      const allowedRoomIds = principal.allowedRoomIds || ["*"];
      if (!allowedRoomIds.includes("*")) {
        const filtered = {};
        for (const [rid, data] of Object.entries(overview.byRoom || {})) {
          if (allowedRoomIds.includes(rid)) filtered[rid] = data;
        }
        overview.byRoom = filtered;
        overview.rooms = (overview.rooms || []).filter(r => allowedRoomIds.includes(r.id));
        overview.zones = (overview.zones || []).filter(z => allowedRoomIds.includes(z.roomId));
        overview.projects = (overview.projects || []).filter(p => !p.roomId || allowedRoomIds.includes(p.roomId));
      }
    }
    return send(res, 200, overview);
  }

  if (url.pathname === "/facility/room-pressure-dashboard" && method === "GET") {
    const dashboard = getRoomPressureDashboard(db);
    if (principal?.role !== ROLES.ADMIN) {
      const allowedRoomIds = principal.allowedRoomIds || ["*"];
      if (!allowedRoomIds.includes("*")) {
        const filteredByRoom = {};
        for (const [rid, data] of Object.entries(dashboard.byRoom || {})) {
          if (allowedRoomIds.includes(rid)) filteredByRoom[rid] = data;
        }
        dashboard.byRoom = filteredByRoom;
        dashboard.rooms = (dashboard.rooms || []).filter(r => allowedRoomIds.includes(r.id));
        const filteredValues = Object.values(filteredByRoom);
        dashboard.summary = {
          totalRooms: filteredValues.length,
          totalActiveCages: filteredValues.reduce((s, r) => s + r.activeCageCount, 0),
          totalDisabledCages: filteredValues.reduce((s, r) => s + r.disabledCageCount, 0),
          totalOccupied: filteredValues.reduce((s, r) => s + r.occupiedCount, 0),
          totalCapacity: filteredValues.reduce((s, r) => s + r.totalCapacity, 0),
          overallOccupancyRate: 0,
          totalQuarantineAnimals: filteredValues.reduce((s, r) => s + r.quarantineAnimalCount, 0),
          totalBreedingPairs: filteredValues.reduce((s, r) => s + r.breedingPairCount, 0),
          totalPendingHealthEvents: filteredValues.reduce((s, r) => s + r.pendingHealthEventCount, 0)
        };
        const cap = dashboard.summary.totalCapacity;
        const occ = dashboard.summary.totalOccupied;
        dashboard.summary.overallOccupancyRate = cap > 0 ? Number(((occ / cap) * 100).toFixed(2)) : 0;
      }
    }
    return send(res, 200, dashboard);
  }

  if (url.pathname === "/facility/defaults" && method === "GET") {
    return send(res, 200, {
      defaultRoomId: DEFAULT_ROOM_ID,
      defaultZoneId: DEFAULT_ZONE_ID,
      defaultProjectId: DEFAULT_PROJECT_ID
    });
  }

  if (url.pathname === "/rooms" && method === "GET") {
    const filters = {
      status: readQuery("status") || undefined,
      building: readQuery("building") || undefined
    };
    let rooms = listRooms(db, filters);
    if (principal?.role !== ROLES.ADMIN) {
      const allowedRoomIds = principal.allowedRoomIds || ["*"];
      if (!allowedRoomIds.includes("*")) {
        rooms = rooms.filter(r => allowedRoomIds.includes(r.id));
      }
    }
    return send(res, 200, { total: rooms.length, items: rooms });
  }

  if (url.pathname.startsWith("/rooms/") && method === "GET") {
    const id = url.pathname.split("/")[2];
    const room = getRoom(db, id);
    if (!room) return send(res, 404, { error: "room_not_found", message: "房间不存在" });
    const access = validateRoomAccess(principal, room.id);
    if (!access.authorized) return send(res, 403, { error: "forbidden", message: access.message });
    return send(res, 200, room);
  }

  if (url.pathname === "/rooms" && method === "POST") {
    assertRole(principal, ROLES.ADMIN);
    const body = req._auditBody || {};
    const errors = [];
    if (!body.name) errors.push({ field: "name", message: "房间名称必填" });
    if (errors.length) return send(res, 400, { error: "validation_failed", errors });
    const room = addRoom(db, body);
    return send(res, 201, room);
  }

  if (url.pathname.startsWith("/rooms/") && method === "PATCH") {
    assertRole(principal, ROLES.ADMIN);
    const id = url.pathname.split("/")[2];
    const body = req._auditBody || {};
    const room = updateRoom(db, id, body);
    if (!room) return send(res, 404, { error: "room_not_found", message: "房间不存在" });
    return send(res, 200, room);
  }

  if (url.pathname === "/zones" && method === "GET") {
    const filters = {
      roomId: readQuery("roomId") || undefined
    };
    let zones = listZones(db, filters);
    if (principal?.role !== ROLES.ADMIN) {
      const allowedRoomIds = principal.allowedRoomIds || ["*"];
      if (!allowedRoomIds.includes("*")) {
        zones = zones.filter(z => allowedRoomIds.includes(z.roomId));
      }
    }
    return send(res, 200, { total: zones.length, items: zones });
  }

  if (url.pathname.startsWith("/zones/") && method === "GET") {
    const id = url.pathname.split("/")[2];
    const zone = getZone(db, id);
    if (!zone) return send(res, 404, { error: "zone_not_found", message: "区域不存在" });
    const access = validateRoomAccess(principal, zone.roomId);
    if (!access.authorized) return send(res, 403, { error: "forbidden", message: access.message });
    return send(res, 200, zone);
  }

  if (url.pathname === "/zones" && method === "POST") {
    assertRole(principal, ROLES.ADMIN);
    const body = req._auditBody || {};
    const errors = [];
    if (!body.name) errors.push({ field: "name", message: "区域名称必填" });
    if (!body.roomId) errors.push({ field: "roomId", message: "所属房间必填" });
    if (errors.length) return send(res, 400, { error: "validation_failed", errors });
    const zone = addZone(db, body);
    return send(res, 201, zone);
  }

  if (url.pathname === "/projects" && method === "GET") {
    const filters = {
      status: readQuery("status") || undefined,
      roomId: readQuery("roomId") || undefined
    };
    let projects = listProjects(db, filters);
    if (principal?.role !== ROLES.ADMIN) {
      const allowedProjectIds = principal.allowedProjectIds || ["*"];
      const allowedRoomIds = principal.allowedRoomIds || ["*"];
      if (!allowedProjectIds.includes("*") || !allowedRoomIds.includes("*")) {
        projects = projects.filter(p => {
          const projOk = allowedProjectIds.includes("*") || allowedProjectIds.includes(p.id);
          const roomOk = !p.roomId || allowedRoomIds.includes("*") || allowedRoomIds.includes(p.roomId);
          return projOk && roomOk;
        });
      }
    }
    return send(res, 200, { total: projects.length, items: projects });
  }

  if (url.pathname.startsWith("/projects/") && method === "GET") {
    const id = url.pathname.split("/")[2];
    const project = getProject(db, id);
    if (!project) return send(res, 404, { error: "project_not_found", message: "项目不存在" });
    const roomAccess = project.roomId ? validateRoomAccess(principal, project.roomId) : { authorized: true };
    const projAccess = validateProjectAccess(principal, project.id);
    if (!roomAccess.authorized || !projAccess.authorized) return send(res, 403, { error: "forbidden", message: projAccess.message || roomAccess.message });
    return send(res, 200, project);
  }

  if (url.pathname === "/projects" && method === "POST") {
    assertRole(principal, ROLES.ADMIN);
    const body = req._auditBody || {};
    const errors = [];
    if (!body.name) errors.push({ field: "name", message: "项目名称必填" });
    if (body.roomId) {
      const room = getRoom(db, body.roomId);
      if (!room) errors.push({ field: "roomId", message: "所属房间不存在" });
    }
    if (errors.length) return send(res, 400, { error: "validation_failed", errors });
    const project = addProject(db, body);
    return send(res, 201, project);
  }

  if (url.pathname.startsWith("/projects/") && method === "PATCH") {
    assertRole(principal, ROLES.ADMIN);
    const id = url.pathname.split("/")[2];
    const body = req._auditBody || {};
    const project = updateProject(db, id, body);
    if (!project) return send(res, 404, { error: "project_not_found", message: "项目不存在" });
    return send(res, 200, project);
  }

  if (url.pathname === "/keepers" && method === "GET") {
    const filters = {
      status: readQuery("status") || undefined,
      roomId: readQuery("roomId") || undefined
    };
    let keepers = listKeepers(db, filters);
    if (principal?.role !== ROLES.ADMIN) {
      keepers = keepers.filter(k => k.status === "active");
    }
    return send(res, 200, { total: keepers.length, items: keepers });
  }

  if (url.pathname.startsWith("/keepers/") && method === "GET") {
    const id = url.pathname.split("/")[2];
    const keeper = getKeeper(db, id);
    if (!keeper) return send(res, 404, { error: "keeper_not_found", message: "饲养员不存在" });
    return send(res, 200, keeper);
  }

  if (url.pathname === "/keepers" && method === "POST") {
    assertRole(principal, ROLES.ADMIN);
    const body = req._auditBody || {};
    const errors = [];
    if (!body.name) errors.push({ field: "name", message: "饲养员姓名必填" });
    if (errors.length) return send(res, 400, { error: "validation_failed", errors });
    const keeper = addKeeper(db, body);
    return send(res, 201, keeper);
  }

  if (url.pathname.startsWith("/keepers/") && method === "PATCH") {
    assertRole(principal, ROLES.ADMIN);
    const id = url.pathname.split("/")[2];
    const body = req._auditBody || {};
    const keeper = updateKeeper(db, id, body);
    if (!keeper) return send(res, 404, { error: "keeper_not_found", message: "饲养员不存在" });
    return send(res, 200, keeper);
  }

  if (url.pathname.startsWith("/resolve/room-by-cage/") && method === "GET") {
    const cageId = decodeURIComponent(url.pathname.split("/")[4]);
    const roomId = resolveRoomIdByCage(db, cageId);
    const room = roomId ? getRoom(db, roomId) : null;
    return send(res, 200, { cageId, roomId, room });
  }

  return false;
}
