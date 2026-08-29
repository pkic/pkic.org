import { REPRESENTATIVE_ROLE_IDS } from "../../../../assets/shared/schemas/representative-roles";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";

interface RepresentativeManagementInput {
  memberId: string;
  actorUserId: string;
  databaseUserId?: string | null;
  staffAuthorized: boolean;
}

export function organizationRepresentativeManagementEvidence(
  input: RepresentativeManagementInput,
): AuthorizationEvidence {
  if (input.staffAuthorized) {
    const databaseUserId = input.databaseUserId === undefined ? input.actorUserId : input.databaseUserId;
    if (databaseUserId === null) {
      return {
        sql: "SELECT 1 FROM members WHERE id = ? AND organization_id IS NOT NULL AND status = 'active'",
        bindings: [input.memberId],
      };
    }
    return {
      sql: `SELECT 1
              FROM members member
              JOIN users actor ON actor.id = ? AND actor.active = 1
             WHERE member.id = ?
               AND member.organization_id IS NOT NULL
               AND member.status = 'active'
               AND (
                 actor.role = 'admin'
                 OR EXISTS (
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
      bindings: [databaseUserId, input.memberId],
    };
  }

  return {
    sql: `SELECT 1
            FROM members member
            JOIN users actor ON actor.id = ? AND actor.active = 1
            JOIN organization_representatives representative
              ON representative.member_id = member.id
             AND representative.user_id = actor.id
             AND representative.left_at IS NULL
             AND representative.blocked_at IS NULL
            JOIN user_roles role
              ON role.user_id = actor.id
             AND role.context_type = 'organization'
             AND role.context_id = member.id
             AND role.role_id IN (?, ?)
             AND role.revoked_at IS NULL
             AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           WHERE member.id = ?
             AND member.organization_id IS NOT NULL
             AND member.status = 'active'
           LIMIT 1`,
    bindings: [
      input.actorUserId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
      input.memberId,
    ],
  };
}

export function prepareOrganizationRepresentativeManagementGuard(
  db: DatabaseLike,
  input: RepresentativeManagementInput,
): StatementLike {
  return prepareAuthorizationGuard(db, organizationRepresentativeManagementEvidence(input));
}

export function organizationPrimaryContactEvidence(memberId: string, actorUserId: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM members member
            JOIN users actor ON actor.id = ? AND actor.active = 1
            JOIN organization_representatives representative
              ON representative.member_id = member.id
             AND representative.user_id = actor.id
             AND representative.left_at IS NULL
             AND representative.blocked_at IS NULL
            JOIN user_roles role
              ON role.user_id = actor.id
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

export async function requireOrganizationRepresentativeManagement(
  db: DatabaseLike,
  input: RepresentativeManagementInput,
): Promise<void> {
  const member = await first<{ id: string }>(
    db,
    "SELECT id FROM members WHERE id = ? AND organization_id IS NOT NULL AND status = 'active'",
    [input.memberId],
  );
  if (!member) throw new AppError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Active organization membership not found");
  const evidence = organizationRepresentativeManagementEvidence(input);
  const contact = await first<{ authorized: number }>(db, `SELECT 1 AS authorized WHERE EXISTS (${evidence.sql})`, [
    ...evidence.bindings,
  ]);
  if (!contact) {
    if (input.staffAuthorized) {
      throw new AppError(
        403,
        "ORGANIZATION_REPRESENTATION_MANAGEMENT_REQUIRED",
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

export async function resolveOrganizationMemberId(db: DatabaseLike, organizationId: string): Promise<string> {
  const aggregate = await first<{ id: string | null; status: string | null; category_code: string | null }>(
    db,
    `SELECT member.id, member.status, category.category_code
       FROM organizations organization
       LEFT JOIN members member ON member.organization_id = organization.id
       LEFT JOIN member_category_assignments category ON category.member_id = member.id
      WHERE organization.id = ?`,
    [organizationId],
  );
  if (!aggregate) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (!aggregate.id || !aggregate.category_code) {
    throw new AppError(
      422,
      "ORG_CATEGORY_NOT_SET",
      "Set the organization's membership category before adding representatives",
    );
  }
  if (aggregate.status !== "active") {
    throw new AppError(409, "ORGANIZATION_MEMBERSHIP_INACTIVE", "Organization membership is not active");
  }
  return aggregate.id;
}
