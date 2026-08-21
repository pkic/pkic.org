import type { Permission } from "./permissions";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Canonical permission for a route in the proposal management subtree. */
export function proposalPermissionForRequest(path: string, method: string): Permission {
  const normalizedMethod = method.toUpperCase();
  if (!WRITE_METHODS.has(normalizedMethod)) return "proposals:read";

  if (/\/reviews(?:\/|$)/.test(path) || /\/comments(?:\/|$)/.test(path)) {
    return "proposals:score";
  }
  return "proposals:manage";
}
