import type { SessionPasskeyAuthentication } from "../../../assets/shared/schemas/session-authentication";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

/** Proof is tied to this session's creation and to a still-active credential owned by the same person. */
export function passkeySessionAuthenticationEvidence(
  userId: string,
  sessionId: string,
  authentication: SessionPasskeyAuthentication,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM sessions session JOIN passkey_credentials credential ON credential.user_id=session.user_id
      WHERE session.id=? AND session.user_id=? AND session.created_at=? AND session.revoked_at IS NULL
        AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND credential.id=? AND credential.revoked_at IS NULL`,
    bindings: [sessionId, userId, authentication.authenticatedAt, authentication.credentialId],
  };
}

export async function sessionHasActivePasskeyAuthentication(
  db: DatabaseLike,
  userId: string,
  sessionId: string,
  authentication: SessionPasskeyAuthentication,
): Promise<boolean> {
  const at = Date.parse(authentication.authenticatedAt);
  if (!Number.isFinite(at) || at > Date.now()) return false;
  const evidence = passkeySessionAuthenticationEvidence(userId, sessionId, authentication);
  return Boolean(await first(db, evidence.sql, [...evidence.bindings]));
}

export async function requireSessionPasskeyAuthentication(
  db: DatabaseLike,
  userId: string,
  sessionId: string,
  authentication: SessionPasskeyAuthentication,
): Promise<void> {
  if (!(await sessionHasActivePasskeyAuthentication(db, userId, sessionId, authentication)))
    throw new AppError(401, "PASSKEY_AUTHENTICATION_REQUIRED", "Sign in with a passkey to authorize longer access.");
}
