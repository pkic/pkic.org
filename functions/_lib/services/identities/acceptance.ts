import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  verifyEmailAuthCapabilityToken,
} from "../../auth/email-auth-capabilities";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import {
  loadIdentityNotificationContext,
  prepareIdentityNotification,
  type IdentityNotificationContext,
} from "./notifications";

interface PendingIdentityRow {
  id: string;
  member_id: string;
  user_id: string;
  organization_id: string;
  updated_at: string;
}

async function loadPendingIdentity(db: DatabaseLike, identityId: string, userId?: string): Promise<PendingIdentityRow> {
  const identity = await first<PendingIdentityRow>(
    db,
    `SELECT identity.id, capacity.member_id, identity.user_id,
            identity.organization_id, identity.updated_at
       FROM identities identity
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      WHERE identity.id = ?
        AND (? IS NULL OR identity.user_id = ?)
        AND identity.organization_id IS NOT NULL
        AND identity.started_at IS NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL`,
    [identityId, userId ?? null, userId ?? null],
  );
  if (!identity) {
    throw new AppError(404, "IDENTITY_INVITATION_NOT_FOUND", "Pending identity invitation not found");
  }
  return identity;
}

function prepareAcceptanceStatements(
  db: DatabaseLike,
  identity: PendingIdentityRow,
  context: IdentityNotificationContext,
  at: string,
  includeAudit: boolean,
): StatementLike[] {
  return [
    db
      .prepare(
        `UPDATE identities
            SET started_at = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
            AND started_at IS NULL AND ended_at IS NULL AND blocked_at IS NULL
            AND updated_at = ?`,
      )
      .bind(at, at, identity.id, identity.user_id, identity.updated_at),
    ...(includeAudit
      ? [
          prepareScopedAuditLogAfterOneChange(
            db,
            { type: "organization", id: identity.member_id },
            "user",
            identity.user_id,
            "organization_identity_invitation_accepted",
            "identity",
            identity.id,
            { organizationId: identity.organization_id },
            at,
          ),
        ]
      : []),
    prepareIdentityNotification(db, {
      identityId: identity.id,
      userId: identity.user_id,
      context,
      action: "activated",
      at,
    }),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, identity.user_id, at),
  ];
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
  const identity = await loadPendingIdentity(db, input.identityId, input.userId);

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
      ...prepareAcceptanceStatements(db, identity, context, at, true),
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

async function resolveInvitationLink(db: DatabaseLike, input: { token: string; signingSecret: string }) {
  const capability = await verifyEmailAuthCapabilityToken({
    token: input.token,
    signingSecret: input.signingSecret,
    purpose: "identity_invitation",
  });
  const identity = await loadPendingIdentity(db, capability.subjectId);
  const context = await loadIdentityNotificationContext(db, identity.member_id, identity.user_id, true);
  await assertEmailAuthCapabilityEmail({
    signingSecret: input.signingSecret,
    capability,
    currentEmail: context.email,
  });
  return { identity, context, capability };
}

/** Preview is read-only: mail scanners may follow the URL but cannot accept it. */
export async function previewIdentityInvitation(
  db: DatabaseLike,
  input: { token: string; signingSecret: string },
): Promise<{ organizationName: string; recipientEmail: string }> {
  const { context } = await resolveInvitationLink(db, input);
  return { organizationName: context.organization_name, recipientEmail: context.email };
}

/** The emailed capability accepts one pending identity without establishing a login session. */
export async function acceptIdentityInvitationLink(
  db: DatabaseLike,
  input: { token: string; signingSecret: string },
): Promise<{ identityId: string; state: "active" }> {
  const { identity, context, capability } = await resolveInvitationLink(db, input);
  const at = nowIso();
  await commitEmailAuthRedemption(db, {
    purpose: "identity_invitation",
    capabilityId: capability.capabilityId,
    actorType: "user",
    actorId: identity.user_id,
    action: "organization_identity_invitation_accepted",
    entityType: "identity",
    entityId: identity.id,
    scope: { type: "organization", id: identity.member_id },
    details: { organizationId: identity.organization_id },
    createdAt: at,
    authorizationEvidence: {
      sql: `SELECT 1
              FROM identities identity
              JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
              JOIN users user ON user.id = identity.user_id AND user.active = 1
             WHERE identity.id = ? AND identity.user_id = ?
               AND identity.updated_at = ?
               AND identity.started_at IS NULL AND identity.ended_at IS NULL
               AND identity.blocked_at IS NULL AND user.email = ?`,
      bindings: [identity.id, identity.user_id, identity.updated_at, context.email],
    },
    statements: prepareAcceptanceStatements(db, identity, context, at, false),
  });
  return { identityId: identity.id, state: "active" };
}
