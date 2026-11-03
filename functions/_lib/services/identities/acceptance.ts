import { preparePendingIdentityActivation } from "./pending-activation";
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
import type { IdentityNotificationContext } from "./notifications";

import { organizationIdentityAuditScope } from "./authorization";
import { IDENTITY_INVITATION_VIEWERS } from "../../../../assets/shared/schemas/identity";

interface PendingIdentityRow {
  id: string;
  member_id: string | null;
  user_id: string;
  organization_id: string;
  updated_at: string;
}

type PendingInvitationContext = PendingIdentityRow & IdentityNotificationContext & { user_active: number };

async function loadPendingIdentity(
  db: DatabaseLike,
  identityId: string,
  userId?: string,
): Promise<PendingInvitationContext> {
  const identity = await first<PendingInvitationContext>(
    db,
    `SELECT identity.id, capacity.member_id, identity.user_id,
            identity.organization_id, identity.updated_at,
            user.email, user.active AS user_active,
            trim(COALESCE(user.first_name, '') || ' ' || COALESCE(user.last_name, '')) AS recipient_name,
            organization.name AS organization_name
       FROM identities identity
       LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
       JOIN users user ON user.id = identity.user_id
       JOIN organizations organization ON organization.id = identity.organization_id
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
  at: string,
  includeAudit: boolean,
): StatementLike[] {
  return preparePendingIdentityActivation(db, {
    identityId: identity.id,
    userId: identity.user_id,
    at,
    expectedUpdatedAt: identity.updated_at,
    audit: includeAudit
      ? [
          prepareScopedAuditLogAfterOneChange(
            db,
            organizationIdentityAuditScope(identity.member_id, identity.user_id),
            "user",
            identity.user_id,
            "organization_identity_invitation_accepted",
            "identity",
            identity.id,
            { organizationId: identity.organization_id },
            at,
          ),
        ]
      : [],
  });
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
      ...prepareAcceptanceStatements(db, identity, at, true),
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
  if (!identity.user_active) throw new AppError(404, "USER_NOT_FOUND", "Active user not found");
  const context = identity;
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
  input: { token: string; signingSecret: string; signedInUserId?: string },
): Promise<{ organizationName: string; recipientEmail: string; viewer: IdentityInvitationViewer }> {
  const { identity, context } = await resolveInvitationLink(db, input);
  return {
    organizationName: context.organization_name,
    recipientEmail: context.email,
    viewer: invitationViewer(identity.user_id, input.signedInUserId),
  };
}

type IdentityInvitationViewer = (typeof IDENTITY_INVITATION_VIEWERS)[number];

function invitationViewer(inviteeUserId: string, signedInUserId: string | undefined): IdentityInvitationViewer {
  if (!signedInUserId) return "signed_out";
  return signedInUserId === inviteeUserId ? "invitee" : "another_person";
}

/**
 * The emailed capability accepts one pending identity without establishing a
 * login session. Someone signed in as another person cannot accept it: a
 * forwarded link would otherwise activate the invitee's identity from an
 * account that is not theirs, without either person noticing.
 */
export async function acceptIdentityInvitationLink(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; signedInUserId?: string },
): Promise<{ identityId: string; state: "active" }> {
  const { identity, context, capability } = await resolveInvitationLink(db, input);
  if (invitationViewer(identity.user_id, input.signedInUserId) === "another_person")
    throw new AppError(
      409,
      "IDENTITY_INVITATION_OTHER_ACCOUNT",
      "This invitation is for another person. Sign out, then open the link again.",
    );
  const at = nowIso();
  await commitEmailAuthRedemption(db, {
    purpose: "identity_invitation",
    capabilityId: capability.capabilityId,
    actorType: "user",
    actorId: identity.user_id,
    action: "organization_identity_invitation_accepted",
    entityType: "identity",
    entityId: identity.id,
    scope: organizationIdentityAuditScope(identity.member_id, identity.user_id),
    details: { organizationId: identity.organization_id },
    createdAt: at,
    authorizationEvidence: {
      sql: `SELECT 1
              FROM identities identity
              LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
              JOIN users user ON user.id = identity.user_id AND user.active = 1
             WHERE identity.id = ? AND identity.user_id = ?
               AND identity.updated_at = ?
               AND identity.started_at IS NULL AND identity.ended_at IS NULL
               AND identity.blocked_at IS NULL AND user.email = ?`,
      bindings: [identity.id, identity.user_id, identity.updated_at, context.email],
    },
    statements: prepareAcceptanceStatements(db, identity, at, false),
  });
  return { identityId: identity.id, state: "active" };
}
