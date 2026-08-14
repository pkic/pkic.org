import { AppError } from "../errors";
import type { AuthAdmin } from "../types";

export const AUTH_SCOPES = [
  "admin:read",
  "events:read",
  "proposals:read",
  "proposal-reviews:read",
  "proposal-reviews:write",
  "proposal-finalization:write",
  "sponsor-attendees:read",
  "presentations:review",
  "presentations:delete",
] as const;

export type AuthScope = (typeof AUTH_SCOPES)[number];

export function hasAuthScope(actor: AuthAdmin, scope: AuthScope): boolean {
  return actor.scopes?.includes(scope) === true;
}

export function requireAuthScope(actor: AuthAdmin, scope: AuthScope): void {
  if (!hasAuthScope(actor, scope)) {
    throw new AppError(403, "SCOPE_REQUIRED", `Missing required scope: ${scope}`);
  }
}

export function grantableScopesForActor(actor: AuthAdmin, requestedScopes: readonly AuthScope[]): AuthScope[] {
  if (actor.role === "admin" && !actor.scopes) {
    return [...requestedScopes];
  }

  return requestedScopes.filter((scope) => hasAuthScope(actor, scope));
}
