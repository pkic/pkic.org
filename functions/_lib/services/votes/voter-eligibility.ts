import type { AuthMember } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { voteParticipantGroupIdsQuery } from "./vote-access";

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

/**
 * Current eligible electorate and effective-ballot intersection for one vote.
 * This is the canonical set-based counterpart to the individual authorization
 * predicates above. It intentionally covers every owner or explicitly shared
 * participation group; the selected group in a management URL authorizes the
 * read but does not redefine the vote's electorate.
 */
export const VOTE_CURRENT_PARTICIPATION_STATISTICS_QUERY = `
  WITH target_vote AS (
    SELECT id, vote_type, electorate_mode, status, current_round, eligible_categories, owner_group_id
      FROM votes
     WHERE id = ?
  ),
  participant_groups AS (
    ${voteParticipantGroupIdsQuery("target_vote")}
  ),
  eligible_units AS (
    SELECT DISTINCT target_vote.id AS vote_id, membership.member_id AS unit_id
      FROM target_vote
      JOIN participant_groups
      JOIN group_memberships membership INDEXED BY idx_group_memberships_group_active
        ON membership.group_id = participant_groups.group_id
       AND membership.left_at IS NULL
      JOIN members represented_member
        ON represented_member.id = membership.member_id
       AND represented_member.status = 'active'
       AND represented_member.organization_id IS NOT NULL
      JOIN member_category_assignments category ON category.member_id = represented_member.id
      JOIN organization_representatives representative
        ON representative.member_id = represented_member.id
       AND representative.user_id = membership.user_id
       AND representative.left_at IS NULL
       AND representative.blocked_at IS NULL
      JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
     WHERE target_vote.electorate_mode = 'per_member'
       AND (
         target_vote.eligible_categories IS NULL
         OR EXISTS (
           SELECT 1 FROM json_each(target_vote.eligible_categories) allowed
            WHERE allowed.value = category.category_code
         )
       )
    UNION
    SELECT DISTINCT target_vote.id AS vote_id, membership.user_id AS unit_id
      FROM target_vote
      JOIN participant_groups
      JOIN group_memberships membership INDEXED BY idx_group_memberships_group_active
        ON membership.group_id = participant_groups.group_id
       AND membership.left_at IS NULL
      JOIN members represented_member
        ON represented_member.id = membership.member_id
       AND represented_member.status = 'active'
      JOIN member_category_assignments category
        ON category.member_id = represented_member.id
       AND category.category_code IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')
      JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
     WHERE target_vote.electorate_mode = 'per_person'
       AND (
         target_vote.eligible_categories IS NULL
         OR EXISTS (
           SELECT 1 FROM json_each(target_vote.eligible_categories) allowed
            WHERE allowed.value = category.category_code
         )
       )
  )
  SELECT target_vote.id AS vote_id,
         target_vote.vote_type,
         target_vote.electorate_mode,
         target_vote.status,
         target_vote.current_round,
         COUNT(eligible_units.unit_id) AS current_eligible,
         COUNT(CASE WHEN eligible_ballot.id IS NOT NULL THEN 1 END) AS current_eligible_cast,
         (
           SELECT COUNT(*)
             FROM vote_ballots effective_ballot INDEXED BY idx_vote_ballots_vote_round
            WHERE effective_ballot.vote_id = target_vote.id
              AND effective_ballot.round = target_vote.current_round
         ) AS effective_ballots
    FROM target_vote
    LEFT JOIN eligible_units ON eligible_units.vote_id = target_vote.id
    LEFT JOIN vote_ballots eligible_ballot
      ON eligible_ballot.vote_id = target_vote.id
     AND eligible_ballot.round = target_vote.current_round
     AND (
       (target_vote.electorate_mode = 'per_member' AND eligible_ballot.member_id = eligible_units.unit_id)
       OR (target_vote.electorate_mode = 'per_person' AND eligible_ballot.user_id = eligible_units.unit_id)
     )
   GROUP BY target_vote.id`;
