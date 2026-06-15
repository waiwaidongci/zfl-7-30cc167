import { ROLES } from "./apiKeys.js";
import { canKeeperAccessRoom, canKeeperAccessProject, DEFAULT_ROOM_ID, DEFAULT_PROJECT_ID } from "./facilityData.js";
import { getCage } from "./cageData.js";

export const ACTIONS = {
  READ: "read",
  WRITE: "write",
  ADMIN: "admin"
};

const endpointPatterns = [
  { method: "GET", path: /^\/$/, action: ACTIONS.READ },

  { method: "GET", path: /^\/facility\/overview$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/facility\/room-pressure-dashboard$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/facility\/defaults$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/rooms$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/rooms\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/rooms$/, action: ACTIONS.ADMIN },
  { method: "PATCH", path: /^\/rooms\/[^/]+$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/zones$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/zones\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/zones$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/projects$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/projects\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/projects$/, action: ACTIONS.ADMIN },
  { method: "PATCH", path: /^\/projects\/[^/]+$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/keepers$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/keepers\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/keepers$/, action: ACTIONS.ADMIN },
  { method: "PATCH", path: /^\/keepers\/[^/]+$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/resolve\//, action: ACTIONS.READ },

  { method: "GET", path: /^\/cages$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/cages\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/cages$/, action: ACTIONS.ADMIN },
  { method: "POST", path: /^\/cages\/[^/]+\/disable$/, action: ACTIONS.ADMIN },

  { method: "GET", path: /^\/animals$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/animals\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/animals$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/import\/preview$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/import$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/[^/]+\/notes$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/[^/]+\/move$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/[^/]+\/remove$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/[^/]+\/quarantine\/record$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/[^/]+\/quarantine\/release$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/[^/]+\/quarantine\/abnormal$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/animals\/[^/]+\/quarantine\/resolve$/, action: ACTIONS.WRITE },

  { method: "GET", path: /^\/reports\/stock$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/reports\/upcoming$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/reports\/health-events$/, action: ACTIONS.READ },

  { method: "GET", path: /^\/feeding\/plans$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/feeding\/plans\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/feeding\/plans$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/feeding\/plans\/[^/]+\/disable$/, action: ACTIONS.WRITE },
  { method: "GET", path: /^\/feeding\/today$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/feeding\/today\/summary$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/feeding\/schedule$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/feeding\/schedule\/summary$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/feeding\/checkin$/, action: ACTIONS.WRITE },
  { method: "GET", path: /^\/feeding\/records$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/feeding\/records\/[^/]+$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/feeding\/history$/, action: ACTIONS.READ },

  { method: "GET", path: /^\/breeding\/pairs$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/breeding\/pairs\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/breeding\/pairs$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/breeding\/pairs\/[^/]+\/status$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/breeding\/pairs\/[^/]+\/cancel$/, action: ACTIONS.WRITE },
  { method: "GET", path: /^\/breeding\/litters$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/breeding\/litters\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/breeding\/litters$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/breeding\/litters\/[^/]+\/update$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/breeding\/litters\/[^/]+\/wean$/, action: ACTIONS.WRITE },
  { method: "GET", path: /^\/breeding\/stats$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/breeding\/weaning-forecast$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/breeding\/genealogy\/[^/]+$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/breeding\/offspring\/[^/]+$/, action: ACTIONS.READ },

  { method: "GET", path: /^\/health-events\/meta$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/health-events$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/health-events\/stats$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/health-events$/, action: ACTIONS.WRITE },
  { method: "GET", path: /^\/health-events\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/health-events\/[^/]+\/assign$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/health-events\/[^/]+\/notes$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/health-events\/[^/]+\/close$/, action: ACTIONS.WRITE },
  { method: "POST", path: /^\/health-events\/detect$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/health-events\/migrate-historical$/, action: ACTIONS.ADMIN },

  { method: "GET", path: /^\/audit\/logs$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/audit\/logs\/[^/]+$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/audit\/stats$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/audit\/operations$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/audit\/export$/, action: ACTIONS.ADMIN },

  { method: "GET", path: /^\/ledger\/info$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/event-types$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/events$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/events\/[^/]+$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/animals\/[^/]+\/lifecycle$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/export$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/ledger\/verify\/integrity$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/ledger\/verify\/snapshot$/, action: ACTIONS.ADMIN },
  { method: "POST", path: /^\/ledger\/migrate$/, action: ACTIONS.ADMIN },

  { method: "GET", path: /^\/sync\/meta$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/sync\/batch$/, action: ACTIONS.WRITE },
  { method: "GET", path: /^\/sync\/operations$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/sync\/operations\/[^/]+$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/sync\/cage-abnormal$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/sync\/conflicts$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/sync\/conflicts\/[^/]+$/, action: ACTIONS.READ },
  { method: "POST", path: /^\/sync\/conflicts\/[^/]+\/resolve$/, action: ACTIONS.ADMIN },
  { method: "POST", path: /^\/sync\/conflicts\/[^/]+\/dismiss$/, action: ACTIONS.ADMIN }
];

const rolePermissions = {
  [ROLES.READONLY]: [ACTIONS.READ],
  [ROLES.KEEPER]: [ACTIONS.READ, ACTIONS.WRITE],
  [ROLES.ADMIN]: [ACTIONS.READ, ACTIONS.WRITE, ACTIONS.ADMIN]
};

export function resolveEndpointAction(method, pathname) {
  for (const rule of endpointPatterns) {
    if (rule.method === method && rule.path.test(pathname)) {
      return { action: rule.action, matched: true };
    }
  }
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { action: ACTIONS.READ, matched: false };
  }
  return { action: ACTIONS.WRITE, matched: false };
}

export function isActionAllowed(role, action) {
  const allowed = rolePermissions[role] || [];
  return allowed.includes(action);
}

export function authorize(principal, method, pathname) {
  if (!principal) {
    return {
      authorized: false,
      error: "unauthenticated",
      message: "未提供有效的认证凭证",
      status: 401
    };
  }

  const { action, matched } = resolveEndpointAction(method, pathname);
  if (!isActionAllowed(principal.role, action)) {
    return {
      authorized: false,
      error: "insufficient_permission",
      message: `角色 ${principal.role} 无权执行 ${action} 操作 ${method} ${pathname}`,
      status: 403,
      action,
      requiredRole: action === ACTIONS.ADMIN ? ROLES.ADMIN : action === ACTIONS.WRITE ? ROLES.KEEPER : ROLES.READONLY
    };
  }

  return {
    authorized: true,
    action,
    endpointMatched: matched
  };
}

export function getRolePermissionsMap() {
  return JSON.parse(JSON.stringify(rolePermissions));
}

export function getEndpointRules() {
  return endpointPatterns.map((r) => ({
    method: r.method,
    path: r.path.toString(),
    action: r.action
  }));
}

export function validateRoomAccess(principal, roomId) {
  if (!principal) {
    return { authorized: false, error: "unauthenticated", message: "未认证用户" };
  }
  if (principal.role === ROLES.ADMIN) {
    return { authorized: true };
  }
  if (!roomId) {
    return { authorized: true, note: "未指定房间，默认允许" };
  }
  if (canKeeperAccessRoom(principal, roomId)) {
    return { authorized: true };
  }
  return {
    authorized: false,
    error: "room_access_denied",
    message: `无权访问房间 ${roomId}，当前用户允许的房间：${principal.allowedRoomIds?.join(", ") || "无"}`
  };
}

export function validateProjectAccess(principal, projectId) {
  if (!principal) {
    return { authorized: false, error: "unauthenticated", message: "未认证用户" };
  }
  if (principal.role === ROLES.ADMIN) {
    return { authorized: true };
  }
  if (!projectId) {
    return { authorized: true, note: "未指定项目，默认允许" };
  }
  if (canKeeperAccessProject(principal, projectId)) {
    return { authorized: true };
  }
  return {
    authorized: false,
    error: "project_access_denied",
    message: `无权访问项目 ${projectId}，当前用户允许的项目：${principal.allowedProjectIds?.join(", ") || "无"}`
  };
}

export function validateCrossRoomMove(db, principal, fromCageId, toCageId) {
  if (!principal) {
    return { valid: false, error: "unauthenticated", message: "未认证用户" };
  }
  if (principal.role === ROLES.ADMIN) {
    return { valid: true };
  }

  const fromCage = fromCageId ? getCage(db, fromCageId) : null;
  const toCage = toCageId ? getCage(db, toCageId) : null;

  const fromRoomId = fromCage?.roomId || DEFAULT_ROOM_ID;
  const toRoomId = toCage?.roomId || DEFAULT_ROOM_ID;

  const toRoomCheck = validateRoomAccess(principal, toRoomId);
  if (!toRoomCheck.authorized) {
    return {
      valid: false,
      error: "target_room_access_denied",
      message: `无权将动物移入房间 ${toRoomId}`
    };
  }

  if (fromRoomId !== toRoomId) {
    const crossRoomAllowed = principal.allowCrossRoomMove === true || principal.role === ROLES.ADMIN;
    if (!crossRoomAllowed) {
      return {
        valid: false,
        error: "cross_room_move_not_allowed",
        message: `跨房间移动未授权（从房间 ${fromRoomId} 到 ${toRoomId}），请联系管理员`
      };
    }
  }

  return { valid: true, fromRoomId, toRoomId, crossRoom: fromRoomId !== toRoomId };
}

export function filterByRoomAccess(db, principal, items, getRoomIdFn) {
  if (!principal || principal.role === ROLES.ADMIN) {
    return items;
  }
  const allowedRoomIds = principal.allowedRoomIds || ["*"];
  if (allowedRoomIds.includes("*")) {
    return items;
  }
  return items.filter(item => {
    const roomId = getRoomIdFn(item);
    return allowedRoomIds.includes(roomId);
  });
}

export function getPrincipalAllowedScope(principal) {
  if (!principal) return { rooms: [], projects: [], zones: [], isAdmin: false };
  return {
    isAdmin: principal.role === ROLES.ADMIN,
    rooms: principal.allowedRoomIds || ["*"],
    projects: principal.allowedProjectIds || ["*"],
    zones: principal.allowedZones || ["*"],
    allowCrossRoomMove: principal.role === ROLES.ADMIN || principal.allowCrossRoomMove === true
  };
}

export function checkRoomWriteAccess(principal, roomId) {
  if (!principal) return { authorized: false, error: "unauthenticated", message: "未认证用户" };
  if (principal.role === ROLES.ADMIN) return { authorized: true };
  if (!roomId) return { authorized: true, note: "no_room_specified" };
  const allowedRoomIds = principal.allowedRoomIds || ["*"];
  if (allowedRoomIds.includes("*")) return { authorized: true };
  if (allowedRoomIds.includes(roomId)) return { authorized: true };
  return {
    authorized: false,
    error: "room_write_access_denied",
    message: `无权在房间 ${roomId} 执行写操作，当前用户允许的房间：${allowedRoomIds.join(", ")}`
  };
}
