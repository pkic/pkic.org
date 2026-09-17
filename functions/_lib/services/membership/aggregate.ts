/**
 * Staff commands over a membership itself.
 *
 * The subject here is the `members` aggregate — an organization's membership,
 * or an individual's — rather than one identity acting under it. That is the
 * distinction `capacities.ts` does not make: an organization's
 * representatives inherit its category and standing, so changing either
 * through one of them is refused there and belongs here.
 */
import { type MemberUpdateInput } from "../../../../assets/shared/schemas/members-directory";
import { assertCategoryCompatible, prepareMembershipCategoryGuard } from "./categories";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { authorizedMembershipMutationDb } from "../membership-authorization";

interface MemberAggregateRow {
  id: string;
  member_type: "individual" | "organization";
  status: string;
  category_code: string;
  updated_at: string;
}

async function requireMemberAggregate(db: DatabaseLike, memberId: string): Promise<MemberAggregateRow> {
  const member = await first<MemberAggregateRow>(
    db,
    `SELECT m.id, m.member_type, m.status, mca.category_code, m.updated_at
       FROM members m
       JOIN member_category_assignments mca ON mca.member_id = m.id
      WHERE m.id = ?`,
    [memberId],
  );
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Membership not found");
  return member;
}

/**
 * Changes a membership's category or its standing.
 *
 * A category belongs to a kind: the individual codes describe a person with
 * no organization behind them, and an organization cannot hold one — nor an
 * individual an org-tied code. The check is here rather than in a database
 * constraint because the vocabulary is product policy and evolves.
 */
export async function updateMemberAggregate(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  memberId: string,
  input: MemberUpdateInput,
) {
  const member = await requireMemberAggregate(db, memberId);
  if (input.membershipCategory !== undefined) {
    await assertCategoryCompatible(db, input.membershipCategory, member.member_type === "individual");
  }

  const at = nowIso();
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write"]);
  const statements: StatementLike[] = [];
  if (input.membershipCategory !== undefined) {
    statements.push(
      prepareMembershipCategoryGuard(authorizedDb, input.membershipCategory, member.member_type === "individual"),
      authorizedDb
        .prepare("UPDATE member_category_assignments SET category_code = ?, updated_at = ? WHERE member_id = ?")
        .bind(input.membershipCategory, at, memberId),
    );
  }
  if (input.status !== undefined) {
    statements.push(
      authorizedDb
        .prepare("UPDATE members SET status = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
        .bind(input.status, at, memberId, member.updated_at),
    );
  }
  statements.push(
    prepareAuditLogAfterOneChange(
      authorizedDb,
      "admin",
      actor.id,
      "membership_updated",
      "member",
      memberId,
      { ...input, memberType: member.member_type },
      at,
    ),
  );

  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "MEMBERSHIP_CHANGED", "The membership changed while it was being updated");
    }
    throw error;
  }

  return {
    id: memberId,
    memberType: member.member_type,
    membershipCategory: input.membershipCategory ?? member.category_code,
    status: input.status ?? member.status,
  };
}
