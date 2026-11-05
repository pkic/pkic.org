import {
  anyPermissionAuthorizationEvidenceForResource,
  anyPermissionAuthorizationEvidenceFromSelection,
  tokenAllowsPermission,
  guardPermissionDatabase,
  permissionsAuthorizationEvidence,
  type PermissionContext,
} from "../../auth/permissions";
import { scannerCapabilities } from "../../../../assets/shared/event-scanner-permissions";
import type { UserSessionResult } from "../../auth/user-session";
import { activeEffectiveInviteExpirySql, effectiveInviteExpirySql } from "../../invite-validity";
import type { AuthAdmin, DatabaseLike, PermissionGrant } from "../../types";
import { AppError } from "../../errors";

export interface EventAudienceViewer {
  userId: string | null;
  scannerGrants?: readonly PermissionGrant[];
  admin?: AuthAdmin;
}

export function eventAudienceViewer(session: UserSessionResult | null): EventAudienceViewer {
  return {
    userId: session?.identity.id ?? null,
    scannerGrants: session?.staff?.grants ?? [],
    admin: session?.staff,
  };
}

/** Keep management projections and their enrichment inside live event-read authority. */
export function guardEventReadDatabase(db: DatabaseLike, actor: AuthAdmin, context?: PermissionContext): DatabaseLike {
  return guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:read", context }],
    () => new AppError(403, "PERMISSION_REQUIRED", "Event read permission is no longer available"),
  );
}

/**
 * Canonical row-level event visibility predicate. The alias is a trusted
 * source constant, never request input. Every list/detail read uses this SQL
 * before counting or projecting rows so callers never receive data for the
 * frontend to filter.
 */
export function buildEventAudiencePredicate(
  eventAlias: string,
  viewer: EventAudienceViewer,
): { sql: string; bindings: unknown[] } {
  // A delegated account ID identifies the actor; it does not carry human participation access.
  const userId = viewer.admin?.scopeRestricted ? null : viewer.userId;
  if (!userId && !viewer.admin) return { sql: `${eventAlias}.visibility = 'public'`, bindings: [] };
  const actor: AuthAdmin = viewer.admin ?? { identityType: "user", id: userId ?? "", email: "" };
  const globalRead = permissionsAuthorizationEvidence(actor, [{ permission: "events:read" }]);
  const leadPermissions = ["agenda:leads_capture", "agenda:leads_view", "agenda:leads_export"] as const;
  const eventPermissions = [
    "events:read",
    "agenda:read",
    "agenda:scan",
    ...scannerCapabilities,
    "agenda:attendance_read",
    "agenda:attendance_correct",
    "agenda:attendance_import",
    "agenda:appearance_approve",
    ...leadPermissions,
  ];
  const eventRead = anyPermissionAuthorizationEvidenceForResource(actor, eventPermissions, {
    type: "event",
    idSql: `${eventAlias}.id`,
  });
  const sponsorRead = anyPermissionAuthorizationEvidenceForResource(actor, leadPermissions, {
    type: "event_sponsor",
    idSql: "sponsor_scope.id",
  });

  // Delegated callers use explicit grants and public visibility, never the
  // account's memberships, registrations, invitations, or proposals.
  if (!userId) {
    const allowedEvents = eventPermissions.filter((permission) => tokenAllowsPermission(actor, permission));
    const allowedSponsors = leadPermissions.filter((permission) => tokenAllowsPermission(actor, permission));
    const authority = anyPermissionAuthorizationEvidenceFromSelection(actor, eventPermissions, {
      sql: `SELECT value AS permission, 'event' AS context_type, ${eventAlias}.id AS context_id
        FROM json_each(?)
        UNION ALL
        SELECT permission.value AS permission, 'event_sponsor' AS context_type, sponsor_scope.id AS context_id
        FROM sponsorships sponsor_scope CROSS JOIN json_each(?) permission
        WHERE sponsor_scope.event_id=${eventAlias}.id AND sponsor_scope.sponsor_type='event'
          AND sponsor_scope.pipeline_stage='active'`,
      bindings: [JSON.stringify(allowedEvents), JSON.stringify(allowedSponsors)],
    });
    return {
      sql: `(${eventAlias}.visibility = 'public' OR EXISTS (${authority.sql}))`,
      bindings: [...authority.bindings],
    };
  }

  return {
    sql: `(
      EXISTS (${globalRead.sql})
      OR ${eventAlias}.visibility = 'public'
      OR (
        ${eventAlias}.visibility = 'all_members'
        AND (
          EXISTS (
            SELECT 1
              FROM identities audience_identity
              JOIN identity_member_capacities audience_capacity
                ON audience_capacity.identity_id = audience_identity.id
              JOIN members audience_member
                ON audience_member.id = audience_capacity.member_id
               AND audience_member.status = 'active'
             WHERE audience_identity.user_id = ?
               AND audience_identity.started_at IS NOT NULL
               AND audience_identity.ended_at IS NULL
               AND audience_identity.blocked_at IS NULL
          )
        )
      )
      OR (
        ${eventAlias}.visibility = 'group_members'
        AND (
          EXISTS (
            SELECT 1 FROM group_memberships audience_owner_membership
             WHERE audience_owner_membership.group_id = ${eventAlias}.owner_group_id
               AND audience_owner_membership.user_id = ?
               AND audience_owner_membership.left_at IS NULL
          )
          OR EXISTS (
            SELECT 1
              FROM event_group_grants audience_grant
              JOIN groups audience_group
                ON audience_group.id = audience_grant.group_id AND audience_group.active = 1
              JOIN group_memberships audience_shared_membership
                ON audience_shared_membership.group_id = audience_grant.group_id
               AND audience_shared_membership.user_id = ?
               AND audience_shared_membership.left_at IS NULL
             WHERE audience_grant.event_id = ${eventAlias}.id
               AND audience_grant.capability IN ('view', 'register', 'attend')
          )
        )
      )
      OR (
        ${eventAlias}.visibility = 'invitation_only'
        AND (
          EXISTS (
            SELECT 1 FROM registrations audience_registration
             WHERE audience_registration.event_id = ${eventAlias}.id
               AND audience_registration.user_id = ?
               AND audience_registration.status <> 'cancelled'
          )
          OR EXISTS (
            SELECT 1 FROM event_participants audience_participant
             WHERE audience_participant.event_id = ${eventAlias}.id
               AND audience_participant.user_id = ?
               AND audience_participant.status = 'active'
          )
          OR EXISTS (
            SELECT 1 FROM invites audience_invite
             WHERE audience_invite.event_id = ${eventAlias}.id
               AND audience_invite.invitee_email = (
                 SELECT audience_user.normalized_email FROM users audience_user WHERE audience_user.id = ?
               )
               AND audience_invite.status IN ('sent', 'accepted')
               AND ${activeEffectiveInviteExpirySql(
                 effectiveInviteExpirySql("audience_invite", eventAlias),
                 "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
               )}
          )
        )
      )
      OR EXISTS (SELECT 1 FROM registrations own_registration
        WHERE own_registration.event_id = ${eventAlias}.id AND own_registration.user_id = ?)
      OR EXISTS (SELECT 1 FROM session_proposals own_proposal
        WHERE own_proposal.event_id = ${eventAlias}.id AND own_proposal.deleted_at IS NULL
          AND (own_proposal.proposer_user_id = ? OR EXISTS (
            SELECT 1 FROM proposal_speakers own_speaker WHERE own_speaker.proposal_id = own_proposal.id AND own_speaker.user_id = ?)))
      OR EXISTS (${eventRead.sql})
      OR EXISTS (SELECT 1 FROM sponsorships sponsor_scope
        WHERE sponsor_scope.event_id=${eventAlias}.id AND sponsor_scope.sponsor_type='event'
          AND sponsor_scope.pipeline_stage='active' AND EXISTS (${sponsorRead.sql}))
    )`,
    bindings: [
      ...globalRead.bindings,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      ...eventRead.bindings,
      ...sponsorRead.bindings,
    ],
  };
}
