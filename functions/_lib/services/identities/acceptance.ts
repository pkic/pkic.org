import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { loadIdentityNotificationContext, prepareIdentityNotification } from "./notifications";

interface PendingIdentityRow {
  id: string;
  member_id: string;
  user_id: string;
  organization_id: string;
  updated_at: string;
}

/**
 * Accepts exactly one invitation owned by the signed-in user. Invitation
 * delivery and sign-in intentionally grant no Member or group capacity; the
 * lifecycle transition and automatic enrollment commit atomically here.
 */
export async function acceptPendingIdentity(
  db: DatabaseLike,
  input: { identityId: string; userId: string; sessionId: string },
): Promise<{ identityId: string; state: "active" }> {
  const identity = await first<PendingIdentityRow>(
    db,
    `SELECT identity.id, capacity.member_id, identity.user_id,
            identity.organization_id, identity.updated_at
       FROM identities identity
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      WHERE identity.id = ?
        AND identity.user_id = ?
        AND identity.organization_id IS NOT NULL
        AND identity.started_at IS NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL`,
    [input.identityId, input.userId],
  );
  if (!identity) {
    throw new AppError(404, "IDENTITY_INVITATION_NOT_FOUND", "Pending identity invitation not found");
  }

  const at = nowIso();
  const context = await loadIdentityNotificationContext(db, identity.member_id, identity.user_id, true);
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
                 AND identity.started_at IS NULL
                 AND identity.ended_at IS NULL
                 AND identity.blocked_at IS NULL`,
        bindings: [input.sessionId, input.userId, identity.id],
      }),
      db
        .prepare(
          `UPDATE identities
              SET started_at = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
              AND started_at IS NULL AND ended_at IS NULL AND blocked_at IS NULL
              AND updated_at = ?`,
        )
        .bind(at, at, identity.id, input.userId, identity.updated_at),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "organization", id: identity.member_id },
        "user",
        input.userId,
        "organization_identity_invitation_accepted",
        "identity",
        identity.id,
        { organizationId: identity.organization_id },
        at,
      ),
      prepareIdentityNotification(db, {
        identityId: identity.id,
        userId: identity.user_id,
        context,
        action: "activated",
        at,
      }),
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, identity.user_id, at),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "IDENTITY_AUTHORIZATION_CHANGED",
        "The user session or invitation changed while accepting",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CHANGED", "The identity changed concurrently; reload and retry");
    }
    throw error;
  }
  return { identityId: identity.id, state: "active" };
}
