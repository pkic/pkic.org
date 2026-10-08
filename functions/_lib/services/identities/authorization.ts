import { REPRESENTATIVE_ROLE_IDS } from "../../../../assets/shared/schemas/representative-roles";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import type { AuditScope } from "../audit";

interface IdentityManagementInput {
  memberId: string | null;
  organizationId?: string;
  actorUserId: string;
  databaseUserId?: string | null;
  sessionId?: string;
  sessionExpiresAt?: string;
  staffAuthorized: boolean;
}

function organizationIdentityRoleEvidence(input: IdentityManagementInput): AuthorizationEvidence {
  if (input.staffAuthorized) {
    const databaseUserId = input.databaseUserId === undefined ? input.actorUserId : input.databaseUserId;
    if (databaseUserId === null) {
      return {
        sql: "SELECT 1 FROM organizations WHERE id = COALESCE(?, (SELECT organization_id FROM members WHERE id = ?))",
        bindings: [input.organizationId ?? null, input.memberId],
      };
    }
    return {
      sql: `SELECT 1
              FROM organizations organization
              JOIN users actor ON actor.id = ? AND actor.active = 1
             WHERE organization.id = COALESCE(?, (SELECT organization_id FROM members WHERE id = ?))
               AND (
                 EXISTS (
                   SELECT 1
                     FROM user_roles role
                     JOIN role_permissions permission ON permission.role_id = role.role_id
                    WHERE role.user_id = actor.id
                      AND permission.permission = 'membership:write'
                      AND role.context_type IS NULL AND role.context_id IS NULL
                      AND role.revoked_at IS NULL
                      AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 )
                 OR EXISTS (
                   SELECT 1
                     FROM permission_grants grant_row
                    WHERE grant_row.user_id = actor.id
                      AND grant_row.permission = 'membership:write'
                      AND grant_row.context_type IS NULL AND grant_row.context_id IS NULL
                      AND grant_row.revoked_at IS NULL
                      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                 )
               )`,
      bindings: [databaseUserId, input.organizationId ?? null, input.memberId],
    };
  }

  return {
    sql: `SELECT 1
            FROM members member
            JOIN users actor ON actor.id = ? AND actor.active = 1
            JOIN identities identity
              ON identity.organization_id = member.organization_id
             AND identity.user_id = actor.id
             AND identity.started_at IS NOT NULL
             AND identity.ended_at IS NULL
             AND identity.blocked_at IS NULL
            JOIN user_roles role
              ON role.user_id = actor.id
             AND role.identity_id = identity.id
             AND role.context_type = 'organization'
             AND role.context_id = member.id
             AND role.role_id IN (?, ?)
             AND role.revoked_at IS NULL
             AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           WHERE member.id = ?
             AND (? IS NULL OR member.organization_id = ?)
             AND member.organization_id IS NOT NULL
             AND member.status = 'active'
           LIMIT 1`,
    bindings: [
      input.actorUserId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
      input.memberId,
      input.organizationId ?? null,
      input.organizationId ?? null,
    ],
  };
}

/** Rechecks the caller's exact live human session as well as current organization management authority. */
export function organizationIdentityManagementEvidence(input: IdentityManagementInput): AuthorizationEvidence {
  const role = organizationIdentityRoleEvidence(input);
  if (!input.sessionId) return role;
  return {
    sql: `SELECT 1 WHERE EXISTS (${role.sql}) AND EXISTS (
            SELECT 1 FROM sessions session JOIN users actor ON actor.id=session.user_id AND actor.active=1
             WHERE session.id=? AND session.user_id=? AND session.revoked_at IS NULL
               AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
               AND (? IS NULL OR ? > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          )`,
    bindings: [
      ...role.bindings,
      input.sessionId,
      input.databaseUserId ?? input.actorUserId,
      input.sessionExpiresAt ?? null,
      input.sessionExpiresAt ?? null,
    ],
  };
}

export function prepareOrganizationIdentityManagementGuard(
  db: DatabaseLike,
  input: IdentityManagementInput,
): StatementLike {
  return prepareAuthorizationGuard(db, organizationIdentityManagementEvidence(input));
}

export function organizationPrimaryContactEvidence(memberId: string, actorUserId: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM members member
            JOIN users actor ON actor.id = ? AND actor.active = 1
            JOIN identities identity
              ON identity.organization_id = member.organization_id
             AND identity.user_id = actor.id
             AND identity.started_at IS NOT NULL
             AND identity.ended_at IS NULL
             AND identity.blocked_at IS NULL
            JOIN user_roles role
              ON role.user_id = actor.id
             AND role.identity_id = identity.id
             AND role.context_type = 'organization'
             AND role.context_id = member.id
             AND role.role_id = ?
             AND role.revoked_at IS NULL
             AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           WHERE member.id = ?
             AND member.organization_id IS NOT NULL
             AND member.status = 'active'
           LIMIT 1`,
    bindings: [actorUserId, REPRESENTATIVE_ROLE_IDS.primaryContact, memberId],
  };
}

export function prepareOrganizationPrimaryContactGuard(
  db: DatabaseLike,
  memberId: string,
  actorUserId: string,
): StatementLike {
  return prepareAuthorizationGuard(db, organizationPrimaryContactEvidence(memberId, actorUserId));
}

export async function requireOrganizationIdentityManagement(
  db: DatabaseLike,
  input: IdentityManagementInput,
): Promise<void> {
  const member = await first<{ id: string }>(
    db,
    "SELECT id FROM organizations WHERE id = COALESCE(?, (SELECT organization_id FROM members WHERE id = ?))",
    [input.organizationId ?? null, input.memberId],
  );
  if (!member) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  const evidence = organizationIdentityManagementEvidence(input);
  const contact = await first<{ authorized: number }>(db, `SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`, [
    ...evidence.bindings,
  ]);
  if (!contact) {
    if (input.staffAuthorized) {
      throw new AppError(
        403,
        "ORGANIZATION_IDENTITY_MANAGEMENT_REQUIRED",
        "Active membership-management permission is required",
      );
    }
    throw new AppError(
      403,
      "ORGANIZATION_CONTACT_REQUIRED",
      "An active primary or secondary organization contact is required",
    );
  }
}

/** Membership enriches a canonical organization relationship; it is not an affiliation prerequisite. */
export async function resolveOrganizationMemberId(db: DatabaseLike, organizationId: string): Promise<string | null> {
  const organization = await first<{ member_id: string | null }>(
    db,
    `SELECT member.id AS member_id FROM organizations organization
       LEFT JOIN members member ON member.organization_id = organization.id
      WHERE organization.id = ?`,
    [organizationId],
  );
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  return organization.member_id;
}

/** Organization audit scopes use membership IDs; nonmember affiliations stay on the canonical person's scope. */
export function organizationIdentityAuditScope(memberId: string | null, userId: string): AuditScope {
  return memberId === null ? { type: "user", id: userId } : { type: "organization", id: memberId };
}
