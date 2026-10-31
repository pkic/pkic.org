import { AppError } from "../errors";
import type { DatabaseLike, D1StatementResult, Env, PermissionGrant } from "../types";
import { getUserSessionToken, verifyUserSessionToken, type UserSessionTokenClaims } from "./user-session-token";
import { prepareUserSessionClaimsBatch } from "./user-session-live-data";
import type { UserSessionResult } from "./user-session-result";
import { recordAuditActingIdentity } from "../services/audit-actor";

export async function verifyUserSessionRequest(
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<UserSessionTokenClaims> {
  const token = getUserSessionToken(request);
  if (!token) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  if (!env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }
  const verified = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "User session expired" : "Invalid user session token",
    );
  }
  return verified.claims;
}

export interface PreparedUserSessionRead {
  claims: UserSessionTokenClaims;
  statements: ReturnType<typeof prepareUserSessionClaimsBatch>["statements"];
  /** Select an existing live grant candidate after decode validates this person's session. */
  grantsForContext(results: D1StatementResult[], memberId: string | null): PermissionGrant[];
  decode(results: D1StatementResult[]): Promise<UserSessionResult>;
}

/** Verify the JWT locally; compose its canonical live context with the resource's own D1 batch. */
export async function prepareUserSessionRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<PreparedUserSessionRead> {
  const claims = await verifyUserSessionRequest(request, env);
  const read = prepareUserSessionClaimsBatch(db, [claims]);
  return {
    claims,
    statements: read.statements,
    grantsForContext: (results, memberId) => read.grantsForContext(results, 0, memberId),
    async decode(results) {
      const [resolved] = await read.decode(results);
      if (!resolved.ok) throw resolved.error;
      recordAuditActingIdentity(resolved.session.identity.id, resolved.session.actingIdentityId);
      return resolved.session;
    },
  };
}

/** A supplied invalid credential is refused, never silently downgraded to anonymous. */
export async function prepareOptionalUserSessionRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<PreparedUserSessionRead | null> {
  return getUserSessionToken(request) ? prepareUserSessionRequest(db, request, env) : null;
}
