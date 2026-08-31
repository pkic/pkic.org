import type { UserSessionResult } from "../../auth/user-session";
import { activeEffectiveInviteExpirySql, effectiveInviteExpirySql } from "../../invite-validity";

export interface EventAudienceViewer {
  userId: string | null;
  canReadAll: boolean;
}

export function eventAudienceViewer(session: UserSessionResult | null): EventAudienceViewer {
  return {
    userId: session?.identity.id ?? null,
    canReadAll: session?.staff?.role === "admin" || false,
  };
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
  if (viewer.canReadAll) return { sql: "1", bindings: [] };
  if (!viewer.userId) return { sql: `${eventAlias}.visibility = 'public'`, bindings: [] };

  return {
    sql: `(
      ${eventAlias}.visibility = 'public'
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
      OR EXISTS (
        SELECT 1
          FROM user_roles audience_role
          JOIN role_permissions audience_role_permission
            ON audience_role_permission.role_id = audience_role.role_id
           AND audience_role_permission.permission = 'events:read'
         WHERE audience_role.user_id = ?
           AND audience_role.revoked_at IS NULL
           AND (audience_role.expires_at IS NULL OR audience_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           AND (
             (audience_role.context_type IS NULL AND audience_role.context_id IS NULL)
             OR (audience_role.context_type = 'event' AND audience_role.context_id = ${eventAlias}.id)
           )
      )
      OR EXISTS (
        SELECT 1 FROM permission_grants audience_permission
         WHERE audience_permission.user_id = ?
           AND audience_permission.permission = 'events:read'
           AND audience_permission.revoked_at IS NULL
           AND (audience_permission.expires_at IS NULL OR audience_permission.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           AND (
             (audience_permission.context_type IS NULL AND audience_permission.context_id IS NULL)
             OR (audience_permission.context_type = 'event' AND audience_permission.context_id = ${eventAlias}.id)
           )
      )
    )`,
    bindings: [
      viewer.userId,
      viewer.userId,
      viewer.userId,
      viewer.userId,
      viewer.userId,
      viewer.userId,
      viewer.userId,
      viewer.userId,
    ],
  };
}
