import type { AuthMember } from "../../types";

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
      )
    )
)`;

export function activeVoterMembershipBindings(member: AuthMember): unknown[] {
  return [member.userId, member.memberId, member.membershipCategory, member.userId, member.userId];
}
