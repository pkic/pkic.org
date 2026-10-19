import { AppError } from "../errors";
import type { AuthAdmin } from "../types";
import { PERMISSION_DENIED_MESSAGE } from "../../../assets/shared/auth-errors";
import { PERMISSIONS, type Permission } from "../../../assets/shared/schemas/permissions";

/** OAuth scopes are the canonical permission vocabulary, not a parallel ACL. */
export const AUTH_SCOPES = PERMISSIONS;
export type AuthScope = Permission;

export function hasAuthScope(actor: AuthAdmin, scope: AuthScope): boolean {
  return actor.scopes?.includes(scope) === true;
}

export function requireAuthScope(actor: AuthAdmin, scope: AuthScope): void {
  if (!hasAuthScope(actor, scope)) {
    throw new AppError(403, "SCOPE_REQUIRED", PERMISSION_DENIED_MESSAGE);
  }
}

const AUTH_SCOPE_SET = new Set<string>(AUTH_SCOPES);
export function isAuthScope(scope: string): scope is AuthScope {
  return AUTH_SCOPE_SET.has(scope);
}

export function normalizeMcpOauthScopes(
  scopes: readonly string[],
  fallback: readonly AuthScope[] = AUTH_SCOPES,
): AuthScope[] {
  const normalized = scopes.filter(isAuthScope);
  // An omitted scope list receives the documented default. A supplied but
  // wholly invalid list must not be promoted to every supported permission.
  return [...new Set(scopes.length === 0 ? fallback : normalized)];
}
