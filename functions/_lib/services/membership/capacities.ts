/** Staff commands over exact Member acting identities. */
import type { MemberCapacityUpdateInput } from "../../../../assets/shared/schemas/membership-management";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { authorizedMembershipMutationDb } from "../membership-authorization";
import { buildCreateIdentityStatement } from "./identities";
import { buildCreateIndividualMemberStatements } from "./memberships";
import { buildMembershipAccessOffboardingStatements } from "./offboarding";
import { REPRESENTATIVE_ROLE_IDS, buildRevokeRepresentativeRoleStatement } from "./representative-roles";

interface IdentityCapacityRow {
  id: string;
  user_id: string;
  member_id: string;
  organization_id: string | null;
  status: string;
  category_code: string;
  show_on_organization_profile: number;
  identity_updated_at: string;
  member_updated_at: string;
}

async function requireActiveIdentityCapacity(db: DatabaseLike, identityId: string): Promise<IdentityCapacityRow> {
  const identity = await first<IdentityCapacityRow>(
    db,
    `SELECT identity.id, identity.user_id, capacity.member_id, identity.organization_id,
            member.status, category.category_code, identity.show_on_organization_profile,
            identity.updated_at AS identity_updated_at, member.updated_at AS member_updated_at
       FROM identities identity
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
       JOIN members member ON member.id = capacity.member_id
       JOIN member_category_assignments category ON category.member_id = member.id
       JOIN users user ON user.id = identity.user_id
      WHERE identity.id = ?
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
        AND user.active = 1
        AND user.pii_redacted_at IS NULL
        AND user.merged_into_user_id IS NULL`,
    [identityId],
  );
  if (!identity) throw new AppError(404, "IDENTITY_NOT_FOUND", "Active identity not found");
  return identity;
}

function capacityResponse(identity: IdentityCapacityRow, input: MemberCapacityUpdateInput) {
  return {
    id: identity.id,
    userId: identity.user_id,
    organizationId: identity.organization_id,
    membershipCategory: input.membershipCategory ?? identity.category_code,
    status: input.status ?? identity.status,
    showOnOrgProfile:
      input.showOnOrgProfile ?? (identity.organization_id !== null && identity.show_on_organization_profile === 1),
  };
}

export async function updateMembershipCapacity(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  identityId: string,
  input: MemberCapacityUpdateInput,
) {
  const identity = await requireActiveIdentityCapacity(db, identityId);
  if (identity.organization_id && (input.membershipCategory !== undefined || input.status !== undefined)) {
    throw new AppError(
      422,
      "IDENTITY_AGGREGATE_FIELD_NOT_EDITABLE",
      "An organization identity inherits category and status from its organization Member aggregate",
    );
  }
  if (!identity.organization_id && input.showOnOrgProfile !== undefined) {
    throw new AppError(
      422,
      "INDIVIDUAL_PROFILE_VISIBILITY_FORBIDDEN",
      "Individual identities have no organization profile",
    );
  }

  const at = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  const statements: StatementLike[] = [
    // Establish the exact identity/member/user snapshot inside the transaction.
    // The immediately following audit guard turns a zero-row sentinel into a
    // SQL failure, rolling back the complete D1 batch.
    authorizedDb
      .prepare(
        `UPDATE identities SET updated_at = updated_at
          WHERE id = ? AND user_id = ? AND updated_at = ?
            AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM members member
               WHERE member.id = ? AND member.updated_at = ?
            )
            AND EXISTS (
              SELECT 1 FROM users user
               WHERE user.id = ? AND user.active = 1
                 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
            )`,
      )
      .bind(
        identity.id,
        identity.user_id,
        identity.identity_updated_at,
        identity.member_id,
        identity.member_updated_at,
        identity.user_id,
      ),
    prepareAuditLogAfterOneChange(
      authorizedDb,
      "admin",
      actor.id,
      "identity_updated",
      "identity",
      identity.id,
      input,
      at,
    ),
  ];

  if (input.showOnOrgProfile !== undefined) {
    statements.push(
      authorizedDb
        .prepare("UPDATE identities SET show_on_organization_profile = ?, updated_at = ? WHERE id = ?")
        .bind(input.showOnOrgProfile ? 1 : 0, at, identity.id),
    );
  }

  if (!identity.organization_id && input.membershipCategory !== undefined) {
    statements.push(
      authorizedDb
        .prepare("UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?")
        .bind(input.membershipCategory, at, identity.member_id),
    );
  }
  if (!identity.organization_id && input.status !== undefined) {
    statements.push(
      authorizedDb
        .prepare("UPDATE members SET status = ?, updated_at = ? WHERE id = ?")
        .bind(input.status, at, identity.member_id),
    );
  }
  if (input.membershipCategory !== undefined || input.status !== undefined) {
    statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, identity.user_id, at));
  }
  if (!identity.organization_id && identity.status === "active" && input.status && input.status !== "active") {
    statements.push(
      ...(await buildMembershipAccessOffboardingStatements(authorizedDb, {
        userId: identity.user_id,
        memberId: identity.member_id,
        causeKey: `identity:${identity.id}:member-status:${identity.status}->${input.status}`,
        at,
      })),
    );
  }
  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CHANGED", "The identity changed while it was being updated");
    }
    throw error;
  }
  return capacityResponse(identity, input);
}

/** Grants one active individual H5/H6/H7 identity to an existing user. */
export async function grantIndividualMembership(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: { userId: string; membershipCategory: string; activationReason: string },
) {
  const user = await first<{ id: string; updated_at: string }>(
    db,
    `SELECT id, updated_at FROM users
      WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL`,
    [input.userId],
  );
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  if (await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [input.userId])) {
    throw new AppError(409, "MEMBERSHIP_CONFLICT", "This user already holds an individual membership");
  }
  if (
    await first<{ id: string }>(
      db,
      `SELECT id FROM identities
        WHERE user_id = ? AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
      [input.userId],
    )
  ) {
    throw new AppError(409, "IDENTITY_CONFLICT", "This user already has an active acting identity");
  }

  const at = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write", "identities:activate"]);
  const targetEligibility = {
    sql: `SELECT 1 FROM users target
           WHERE target.id = ? AND target.active = 1
             AND target.pii_redacted_at IS NULL AND target.merged_into_user_id IS NULL
             AND target.updated_at = ?
             AND NOT EXISTS (SELECT 1 FROM members WHERE user_id = target.id)
             AND NOT EXISTS (
               SELECT 1 FROM identities identity
                WHERE identity.user_id = target.id
                  AND identity.started_at IS NOT NULL
                  AND identity.ended_at IS NULL
                  AND identity.blocked_at IS NULL
             )`,
    bindings: [input.userId, user.updated_at],
  };
  const {
    memberId,
    statements: [memberInsert, categoryAssignment],
  } = buildCreateIndividualMemberStatements(
    authorizedDb,
    input.userId,
    input.membershipCategory,
    at,
    targetEligibility,
  );
  const identity = await buildCreateIdentityStatement(authorizedDb, {
    userId: input.userId,
    organizationId: null,
    source: "staff",
    startImmediately: true,
    now: at,
    condition: {
      sql: `SELECT 1
              FROM members member
              JOIN users target ON target.id = member.user_id
             WHERE member.id = ? AND member.user_id = ?
               AND member.organization_id IS NULL AND member.status = 'active'
               AND target.active = 1 AND target.pii_redacted_at IS NULL
               AND target.merged_into_user_id IS NULL`,
      bindings: [memberId, input.userId],
    },
  });
  try {
    await authorizedDb.batch([
      memberInsert,
      categoryAssignment,
      identity.statement,
      prepareAuditLogAfterOneChange(
        authorizedDb,
        "admin",
        actor.id,
        "individual_identity_activated",
        "identity",
        identity.identityId,
        {
          userId: input.userId,
          memberId,
          membershipCategory: input.membershipCategory,
          activationReason: input.activationReason,
        },
        at,
      ),
      ...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, input.userId, at),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "MEMBERSHIP_TARGET_CHANGED", "The target user changed while being activated");
    }
    throw error;
  }
  return {
    id: identity.identityId,
    userId: input.userId,
    organizationId: null,
    membershipCategory: input.membershipCategory,
    status: "active" as const,
    showOnOrgProfile: false,
    createdAt: at,
  };
}

export async function removeMembershipCapacity(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  identityId: string,
): Promise<{ user_id: string; organization_id: string | null }> {
  const identity = await requireActiveIdentityCapacity(db, identityId);
  const at = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  const statements: StatementLike[] = [
    authorizedDb
      .prepare(
        `UPDATE identities SET ended_at = ?, updated_at = ?
          WHERE id = ? AND updated_at = ?
            AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
      )
      .bind(at, at, identity.id, identity.identity_updated_at),
    prepareAuditLogAfterOneChange(
      authorizedDb,
      "admin",
      actor.id,
      "identity_ended",
      "identity",
      identity.id,
      { userId: identity.user_id, organizationId: identity.organization_id },
      at,
    ),
    buildRevokeRepresentativeRoleStatement(authorizedDb, {
      memberId: identity.member_id,
      roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
      userId: identity.user_id,
      now: at,
    }),
    buildRevokeRepresentativeRoleStatement(authorizedDb, {
      memberId: identity.member_id,
      roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
      userId: identity.user_id,
      now: at,
    }),
    authorizedDb
      .prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ? AND nominated_user_id = ?")
      .bind(identity.member_id, identity.user_id),
    ...(await buildMembershipAccessOffboardingStatements(authorizedDb, {
      userId: identity.user_id,
      memberId: identity.member_id,
      causeKey: `identity:${identity.id}:ended`,
      at,
    })),
    ...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, identity.user_id, at),
  ];
  if (!identity.organization_id) {
    statements.push(
      authorizedDb
        .prepare("UPDATE members SET status = 'inactive', updated_at = ? WHERE id = ?")
        .bind(at, identity.member_id),
    );
  }
  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "IDENTITY_CHANGED", "The identity changed while it was being ended");
    }
    throw error;
  }
  return { user_id: identity.user_id, organization_id: identity.organization_id };
}
