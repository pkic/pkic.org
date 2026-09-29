import { AppError } from "../errors";
import type { AuthAdmin } from "../types";
import { PERMISSION_DENIED_MESSAGE } from "../../../assets/shared/auth-errors";
import { PERMISSIONS, type Permission } from "../../../assets/shared/schemas/permissions";
import { hasPermission } from "./permissions";

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

export function grantableScopesForActor(actor: AuthAdmin, requestedScopes: readonly AuthScope[]): AuthScope[] {
  return requestedScopes.filter((scope) => hasPermission(actor, scope));
}
