/**
 * Membership-capacity commands shared by the canonical membership routes.
 *
 * An identifier can represent either an individual `members` row or an active
 * `organization_representatives` row. The command resolves that explicitly so
 * callers do not need to know the storage representation of a capacity.
 */
import type { MemberCapacityUpdateInput } from "../../../../assets/shared/schemas/membership-management";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { authorizedMembershipMutationDb } from "../membership-authorization";
import { buildCreateIndividualMemberStatements } from "./memberships";
import { buildMembershipAccessOffboardingStatements } from "./offboarding";
import { REPRESENTATIVE_ROLE_IDS, buildRevokeRepresentativeRoleStatement } from "./representative-roles";

interface IndividualMemberRow {
  id: string;
  user_id: string;
  status: string;
  category_code: string;
  updated_at: string;
  user_updated_at: string;
}

export async function updateMembershipCapacity(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  id: string,
  input: MemberCapacityUpdateInput,
) {
  const representative = await first<{
    id: string;
    member_id: string;
    user_id: string;
    show_on_org_profile: number;
    updated_at: string;
  }>(
    db,
    "SELECT id, member_id, user_id, show_on_org_profile, updated_at FROM organization_representatives WHERE id = ? AND left_at IS NULL",
    [id],
  );

  if (representative) {
    if (input.membershipCategory !== undefined || input.status !== undefined) {
      throw new AppError(
        422,
        "REPRESENTATIVE_FIELD_NOT_EDITABLE",
        "A representative's category/status follow their organization's aggregate — edit those on the organization instead",
      );
    }
    if (input.showOnOrgProfile !== undefined) {
      const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
      try {
        await authorizedDb.batch([
          authorizedDb
            .prepare(
              "UPDATE organization_representatives SET show_on_org_profile = ?, updated_at = ? WHERE id = ? AND left_at IS NULL AND updated_at = ?",
            )
            .bind(input.showOnOrgProfile ? 1 : 0, nowIso(), id, representative.updated_at),
          prepareAuditLogAfterOneChange(authorizedDb, "admin", actor.id, "member_updated", "member", id, input),
        ]);
      } catch (error) {
        if (isAuditChangeGuardFailure(error)) {
          throw new AppError(
            409,
            "MEMBERSHIP_CAPACITY_CHANGED",
            "The membership capacity changed while it was being updated",
          );
        }
        throw error;
      }
    }
    const orgRow = await first<{ organization_id: string; status: string; category_code: string }>(
      db,
      `SELECT member.organization_id, member.status, category.category_code
         FROM members member
         JOIN member_category_assignments category ON category.member_id = member.id
        WHERE member.id = ?`,
      [representative.member_id],
    );
    if (!orgRow) {
      throw new AppError(
        409,
        "MEMBERSHIP_CAPACITY_CHANGED",
        "The membership capacity changed while it was being updated",
      );
    }
    return {
      id,
      userId: representative.user_id,
      organizationId: orgRow.organization_id,
      membershipCategory: orgRow.category_code,
      status: orgRow.status,
      showOnOrgProfile: input.showOnOrgProfile ?? representative.show_on_org_profile === 1,
    };
  }

  const member = await first<IndividualMemberRow>(
    db,
    `SELECT member.id, member.user_id, member.status, category.category_code, member.updated_at,
            user.updated_at AS user_updated_at
       FROM members member
       JOIN users user ON user.id = member.user_id
       JOIN member_category_assignments category ON category.member_id = member.id
      WHERE member.id = ?
        AND member.organization_id IS NULL
        AND user.active = 1
        AND user.pii_redacted_at IS NULL
        AND user.merged_into_user_id IS NULL`,
    [id],
  );
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");

  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  const statements: StatementLike[] = [
    authorizedDb
      .prepare(
        `UPDATE members SET updated_at = updated_at
          WHERE id = ? AND organization_id IS NULL AND status = ? AND updated_at = ?
            AND EXISTS (
              SELECT 1
                FROM users
               WHERE id = ?
                 AND active = 1
                 AND pii_redacted_at IS NULL
                 AND merged_into_user_id IS NULL
                 AND updated_at = ?
            )`,
      )
      .bind(id, member.status, member.updated_at, member.user_id, member.user_updated_at),
    prepareAuditLogAfterOneChange(authorizedDb, "admin", actor.id, "member_updated", "member", id, input),
  ];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (input.status !== undefined) {
    setClauses.push("status = ?");
    values.push(input.status);
  }
  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso());
    values.push(id, member.status, member.updated_at);
    statements.push(
      authorizedDb
        .prepare(`UPDATE members SET ${setClauses.join(", ")} WHERE id = ? AND status = ? AND updated_at = ?`)
        .bind(...values),
    );
  }
  if (input.membershipCategory !== undefined) {
    statements.push(
      authorizedDb
        .prepare(
          `UPDATE member_category_assignments SET category_code = ?, updated_at = ?
            WHERE member_id = ?
              AND EXISTS (SELECT 1 FROM members WHERE id = ? AND organization_id IS NULL AND status = ? AND updated_at = ?)`,
        )
        .bind(input.membershipCategory, nowIso(), id, id, member.status, member.updated_at),
    );
  }
  if (input.membershipCategory !== undefined || input.status !== undefined) {
    statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, member.user_id, nowIso()));
  }
  if (member.status === "active" && input.status !== undefined && input.status !== "active") {
    statements.push(
      ...(await buildMembershipAccessOffboardingStatements(authorizedDb, {
        userId: member.user_id,
        memberId: member.id,
        causeKey: `member:${member.id}:status:${member.status}->${input.status}`,
        at: nowIso(),
      })),
    );
  }
  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBERSHIP_CAPACITY_CHANGED",
        "The membership capacity changed while it was being updated",
      );
    }
    throw error;
  }

  return {
    id,
    userId: member.user_id,
    organizationId: null,
    membershipCategory: input.membershipCategory ?? member.category_code,
    status: input.status ?? member.status,
    showOnOrgProfile: true,
  };
}

/** Grants an org-less individual membership (H5/H6/H7) to an existing user. */
export async function grantIndividualMembership(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  userId: string,
  membershipCategory: string,
) {
  const user = await first<{ id: string; updated_at: string }>(
    db,
    "SELECT id, updated_at FROM users WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
    [userId],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const existingMember = await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [userId]);
  if (existingMember) throw new AppError(409, "ALREADY_MEMBER", "This user already holds a membership");
  const activeRepresentation = await first<{ id: string }>(
    db,
    "SELECT id FROM organization_representatives WHERE user_id = ? AND left_at IS NULL AND blocked_at IS NULL",
    [userId],
  );
  if (activeRepresentation) {
    throw new AppError(
      409,
      "ORGANIZATION_CAPACITY_CONFLICT",
      "A user who represents an organization cannot also hold an individual membership",
    );
  }

  const now = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  const targetEligibility = {
    sql: `SELECT 1
            FROM users target
           WHERE target.id = ?
             AND target.active = 1
             AND target.pii_redacted_at IS NULL
             AND target.merged_into_user_id IS NULL
             AND target.updated_at = ?
             AND NOT EXISTS (SELECT 1 FROM members WHERE user_id = target.id)
             AND NOT EXISTS (
               SELECT 1
                 FROM organization_representatives representative
                WHERE representative.user_id = target.id
                  AND representative.left_at IS NULL
                  AND representative.blocked_at IS NULL
             )`,
    bindings: [userId, user.updated_at],
  };
  const {
    memberId,
    statements: [memberInsert, categoryAssignment],
  } = buildCreateIndividualMemberStatements(authorizedDb, userId, membershipCategory, now, targetEligibility);
  const statements = [
    memberInsert,
    prepareAuditLogAfterOneChange(authorizedDb, "admin", actor.id, "member_created", "member", memberId, {
      userId,
      membershipCategory,
    }),
    categoryAssignment,
    ...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, userId, now),
  ];
  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBERSHIP_TARGET_CHANGED",
        "The user or membership capacity changed while it was being granted",
      );
    }
    throw error;
  }

  return {
    id: memberId,
    userId,
    organizationId: null,
    membershipCategory,
    status: "active" as const,
    showOnOrgProfile: true,
    createdAt: now,
  };
}

export async function removeMembershipCapacity(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  id: string,
): Promise<{ user_id: string; organization_id: string | null }> {
  const representative = await first<{ id: string; member_id: string; user_id: string }>(
    db,
    "SELECT id, member_id, user_id FROM organization_representatives WHERE id = ? AND left_at IS NULL",
    [id],
  );

  if (representative) {
    const orgRow = await first<{ organization_id: string }>(db, "SELECT organization_id FROM members WHERE id = ?", [
      representative.member_id,
    ]);
    const databaseActor = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [actor.id]);
    const now = nowIso();
    const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
    const statements: StatementLike[] = [
      authorizedDb
        .prepare(
          `UPDATE organization_representatives
              SET left_at = ?, blocked_at = ?, blocked_by_user_id = ?, updated_at = ?
            WHERE id = ? AND left_at IS NULL AND blocked_at IS NULL`,
        )
        .bind(now, now, databaseActor?.id ?? null, now, representative.id),
      buildRevokeRepresentativeRoleStatement(authorizedDb, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        userId: representative.user_id,
        now,
      }),
      buildRevokeRepresentativeRoleStatement(authorizedDb, {
        memberId: representative.member_id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        userId: representative.user_id,
        now,
      }),
      authorizedDb
        .prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ? AND nominated_user_id = ?")
        .bind(representative.member_id, representative.user_id),
      ...(await buildMembershipAccessOffboardingStatements(authorizedDb, {
        userId: representative.user_id,
        memberId: representative.member_id,
        causeKey: `representative:${representative.id}:removed`,
        at: now,
      })),
      ...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, representative.user_id, now),
      prepareAuditLog(authorizedDb, "admin", actor.id, "member_removed", "member", id, {
        userId: representative.user_id,
        organizationId: orgRow?.organization_id ?? null,
      }),
    ];
    await authorizedDb.batch(statements);
    return { user_id: representative.user_id, organization_id: orgRow?.organization_id ?? null };
  }

  const member = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id, user_id FROM members WHERE id = ? AND organization_id IS NULL",
    [id],
  );
  if (!member) throw new AppError(404, "NOT_FOUND", "Member not found");

  const at = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  await authorizedDb.batch([
    ...(await buildMembershipAccessOffboardingStatements(authorizedDb, {
      userId: member.user_id,
      memberId: member.id,
      causeKey: `member:${member.id}:removed`,
      at,
    })),
    authorizedDb.prepare("UPDATE members SET status = 'inactive', updated_at = ? WHERE id = ?").bind(at, id),
    ...prepareAutomaticGroupEnrollmentForUserStatements(authorizedDb, member.user_id, at),
    prepareAuditLog(authorizedDb, "admin", actor.id, "member_removed", "member", id, {
      userId: member.user_id,
      organizationId: null,
    }),
  ]);

  return { user_id: member.user_id, organization_id: null };
}
