import { findApiKey, ROLES } from "./apiKeys.js";

export const AUTH_HEADER = "x-api-key";

export function extractApiKey(req) {
  if (!req || !req.headers) return null;
  const headerVal = req.headers[AUTH_HEADER] || req.headers[AUTH_HEADER.toUpperCase()];
  if (headerVal) return headerVal;
  const authHeader = req.headers["authorization"];
  if (authHeader && typeof authHeader === "string") {
    const parts = authHeader.split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      return parts[1];
    }
  }
  return null;
}

export async function authenticate(req) {
  const keyValue = extractApiKey(req);
  if (!keyValue) {
    return {
      authenticated: false,
      error: "missing_api_key",
      message: "缺少 X-API-Key Header 或 Authorization: Bearer <key>",
      status: 401
    };
  }

  const keyRecord = await findApiKey(keyValue);
  if (!keyRecord) {
    return {
      authenticated: false,
      error: "invalid_api_key",
      message: "API Key 无效或不存在",
      status: 401
    };
  }

  const validRoles = Object.values(ROLES);
  if (!validRoles.includes(keyRecord.role)) {
    return {
      authenticated: false,
      error: "invalid_role",
      message: `无效的角色：${keyRecord.role}`,
      status: 403
    };
  }

  return {
    authenticated: true,
    principal: {
      key: keyValue,
      role: keyRecord.role,
      name: keyRecord.name || "未知用户",
      description: keyRecord.description || ""
    }
  };
}

export function requireRole(principal, requiredRole) {
  if (!principal) return false;
  const hierarchy = {
    [ROLES.READONLY]: [ROLES.READONLY],
    [ROLES.KEEPER]: [ROLES.KEEPER, ROLES.READONLY],
    [ROLES.ADMIN]: [ROLES.ADMIN, ROLES.KEEPER, ROLES.READONLY]
  };
  const allowed = hierarchy[principal.role] || [];
  return allowed.includes(requiredRole);
}
