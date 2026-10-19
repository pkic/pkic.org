import { prepareOrganizationIdentityPublication } from "./lifecycle-publication";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { organizationIdentityAuditScope } from "./authorization";
import { resolveIdentityEndedAt } from "./identity-end";
import { loadIdentityNotificationContext, prepareIdentityNotification } from "./notifications";

interface OwnActiveIdentityRow {
  id: string;
  member_id: string | null;
  user_id: string;
  organization_id: string;
  started_at: string;
  updated_at: string;
}

/**
 * Ends one active identity owned by the signed-in user. Ending needs no
 * reason; it is their own representation. The identity's end trigger closes
 * the group seats and roles held through it at the same instant.
 */
export async function endOwnIdentity(
  db: DatabaseLike,
  input: { identityId: string; userId: string; sessionId: string; endedAt?: string },
): Promise<{ identityId: string; state: "ended" }> {
  const identity = await first<OwnActiveIdentityRow>(
    db,
    `SELECT identity.id, capacity.member_id, identity.user_id, identity.organization_id,
            identity.started_at, identity.updated_at
       FROM identities identity
       LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      WHERE identity.id = ? AND identity.user_id = ?
        AND identity.organization_id IS NOT NULL
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL`,
    [input.identityId, input.userId],
  );
  if (!identity) throw new AppError(404, "IDENTITY_NOT_FOUND", "Active identity not found");

  const at = nowIso();
  const endedAt = resolveIdentityEndedAt(input.endedAt, identity.started_at, at);
  const context = await loadIdentityNotificationContext(db, identity.organization_id, identity.user_id, false);
  try {
    await db.batch([
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1
                FROM sessions session
                JOIN users user ON user.id = session.user_id AND user.active = 1
                JOIN identities identity ON identity.user_id = user.id
               WHERE session.id = ?
                 AND session.user_id = ?
                 AND session.revoked_at IS NULL
                 AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
                 AND identity.id = ?
                 AND identity.started_at IS NOT NULL
                 AND identity.ended_at IS NULL
                 AND identity.blocked_at IS NULL`,
        bindings: [input.sessionId, input.userId, identity.id],
      }),
      prepareOrganizationIdentityPublication(db, identity.id, at),
      db
        .prepare(
          `UPDATE identities
              SET ended_at = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
              AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
              AND updated_at = ?`,
        )
        .bind(endedAt, at, identity.id, identity.user_id, identity.updated_at),
      prepareScopedAuditLogAfterOneChange(
        db,
        organizationIdentityAuditScope(identity.member_id, identity.user_id),
        "user",
        identity.user_id,
        "organization_identity_ended",
        "identity",
        identity.id,
        { organizationId: identity.organization_id, endedAt, ended_by: "owner" },
        at,
      ),
      prepareIdentityNotification(db, {
        identityId: identity.id,
        userId: identity.user_id,
        context,
        action: "ended",
        at,
      }),
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, identity.user_id, at, endedAt),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_AUTHORIZATION_CHANGED", "The user session or identity changed while ending");
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CHANGED", "The identity changed concurrently; reload and retry");
    }
    throw error;
  }
  return { identityId: identity.id, state: "ended" };
}
