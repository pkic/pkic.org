import type { AuthMember } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";

/**
 * Execution-time proof that the request's selected membership context is
 * still active, still belongs to the user, and still has the category that
 * was authorized earlier in the request.
 */
export const ACTIVE_VOTER_MEMBERSHIP_SQL = `EXISTS (
  SELECT 1
  FROM members active_member
  JOIN users active_user ON active_user.id = ? AND active_user.active = 1
  JOIN member_category_assignments active_category ON active_category.member_id = active_member.id
  WHERE active_member.id = ?
    AND active_member.status = 'active'
    AND active_category.category_code = ?
    AND (
      active_member.user_id = ?
      OR EXISTS (
        SELECT 1
        FROM organization_representatives active_rep
        WHERE active_rep.member_id = active_member.id
          AND active_rep.user_id = ?
          AND active_rep.left_at IS NULL
          AND active_rep.blocked_at IS NULL
      )
    )
)`;

export function activeVoterMembershipBindings(member: AuthMember): unknown[] {
  return [member.userId, member.memberId, member.membershipCategory, member.userId, member.userId];
}

/** Any current A-G capacity held by a user in one exact group. */
export function activeGroupVoterSql(groupIdExpression = "?"): string {
  return `EXISTS (
  SELECT 1
  FROM group_memberships active_group_membership
  JOIN members active_group_member
    ON active_group_member.id = active_group_membership.member_id
   AND active_group_member.status = 'active'
  JOIN member_category_assignments active_group_category
    ON active_group_category.member_id = active_group_member.id
   AND active_group_category.category_code IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')
  JOIN users active_group_user
    ON active_group_user.id = active_group_membership.user_id
   AND active_group_user.active = 1
  WHERE active_group_membership.user_id = ?
    AND active_group_membership.group_id = ${groupIdExpression}
    AND active_group_membership.left_at IS NULL
    AND EXISTS (
      SELECT 1 FROM groups active_voter_group
      WHERE active_voter_group.id = ${groupIdExpression}
        AND active_voter_group.active = 1
    )
    AND (
      active_group_member.user_id = active_group_membership.user_id
      OR EXISTS (
        SELECT 1
        FROM organization_representatives active_group_rep
        WHERE active_group_rep.member_id = active_group_member.id
          AND active_group_rep.user_id = active_group_membership.user_id
          AND active_group_rep.left_at IS NULL
          AND active_group_rep.blocked_at IS NULL
      )
  )
)`;
}

export const ACTIVE_GROUP_VOTER_SQL = activeGroupVoterSql();

export function activeGroupVoterBindings(userId: string, groupId: string): unknown[] {
  return [userId, groupId, groupId];
}

export function activeGroupVoterAuthorizationEvidence(userId: string, groupId: string): AuthorizationEvidence {
  return { sql: `SELECT 1 WHERE ${ACTIVE_GROUP_VOTER_SQL}`, bindings: activeGroupVoterBindings(userId, groupId) };
}
