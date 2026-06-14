import { ROLES } from "./apiKeys.js";

export const ACTIONS = {
  READ: "read",
  WRITE: "write",
  ADMIN: "admin"
};

const endpointPatterns = [
  { method: "GET", path: /^\/$/, action: ACTIONS.READ },
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

  { method: "GET", path: /^\/ledger\/info$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/event-types$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/events$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/events\/[^/]+$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/animals\/[^/]+\/lifecycle$/, action: ACTIONS.READ },
  { method: "GET", path: /^\/ledger\/export$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/ledger\/verify\/integrity$/, action: ACTIONS.ADMIN },
  { method: "GET", path: /^\/ledger\/verify\/snapshot$/, action: ACTIONS.ADMIN },
  { method: "POST", path: /^\/ledger\/migrate$/, action: ACTIONS.ADMIN }
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
