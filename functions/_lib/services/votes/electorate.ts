import { votingMembershipCategoryExistsSql } from "../membership/categories";

/**
 * One definition of who is entitled to a ballot.
 *
 * The per-member and per-person electorates legitimately differ in their
 * joins — only a per-member ballot requires an organizational identity — but
 * the *policy* conditions are identical, and previously
 * each branch restated them. Quorum needs to count exactly the electorate
 * that may cast, so a second restatement would have made a drifting count the
 * most likely bug in the feature.
 */

const SAFE_SQL_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function assertReference(reference: string): string {
  if (!SAFE_SQL_REFERENCE.test(reference)) {
    throw new Error("Electorate SQL requires a qualified column reference");
  }
  return reference;
}

/**
 * A membership category may cast at all (`is_voting`) and is permitted by
 * this vote's own restriction. Interested-party categories are excluded here
 * structurally, so a vote created without `eligible_categories` still cannot
 * enfranchise them.
 */
export function voteCategoryEligibilitySql(voteAlias: string, categoryCodeReference: string): string {
  const vote = assertReference(voteAlias);
  const category = assertReference(categoryCodeReference);
  return `${votingMembershipCategoryExistsSql(category)}
    AND (
      ${vote}.eligible_categories IS NULL
      OR EXISTS (
        SELECT 1 FROM json_each(${vote}.eligible_categories) allowed
        WHERE allowed.value = ${category}
      )
    )`;
}

/**
 * A Member explicitly barred from this vote. Distinct from category
 * eligibility because the bylaws bar an individual Member — the subject of a
 * withdrawal proposal — while leaving its category entirely enfranchised.
 */
export function voteMemberNotExcludedSql(voteAlias: string, memberIdReference: string): string {
  const vote = assertReference(voteAlias);
  const member = assertReference(memberIdReference);
  return `(
    ${vote}.excluded_member_ids IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM json_each(${vote}.excluded_member_ids) excluded
      WHERE excluded.value = ${member}
    )
  )`;
}

/**
 * How many Members could have cast a ballot in a per-member vote — the
 * denominator a turnout floor is measured against.
 */
export const ELIGIBLE_MEMBER_COUNT_QUERY = `
  SELECT COUNT(DISTINCT represented_member.id) AS eligible
    FROM votes current_vote
    JOIN group_memberships membership
      ON membership.group_id = current_vote.owner_group_id
     AND membership.left_at IS NULL
    JOIN members represented_member ON represented_member.id = membership.member_id
    JOIN member_category_assignments category ON category.member_id = represented_member.id
    JOIN identities identity
      ON identity.id = membership.identity_id
     AND identity.user_id = membership.user_id
     AND identity.organization_id = represented_member.organization_id
     AND identity.started_at IS NOT NULL
     AND identity.ended_at IS NULL
     AND identity.blocked_at IS NULL
    JOIN users representative_user
      ON representative_user.id = membership.user_id
     AND representative_user.active = 1
   WHERE current_vote.id = ?
     AND represented_member.status = 'active'
     AND represented_member.organization_id IS NOT NULL
     AND ${voteCategoryEligibilitySql("current_vote", "category.category_code")}
     AND ${voteMemberNotExcludedSql("current_vote", "represented_member.id")}`;

/** The same denominator for a per-person vote: distinct eligible people. */
export const ELIGIBLE_PERSON_COUNT_QUERY = `
  SELECT COUNT(DISTINCT membership.user_id) AS eligible
    FROM votes current_vote
    JOIN group_memberships membership
      ON membership.group_id = current_vote.owner_group_id
     AND membership.left_at IS NULL
    JOIN members represented_member ON represented_member.id = membership.member_id
    JOIN member_category_assignments category ON category.member_id = represented_member.id
    JOIN users participant ON participant.id = membership.user_id AND participant.active = 1
   WHERE current_vote.id = ?
     AND represented_member.status = 'active'
     AND ${voteCategoryEligibilitySql("current_vote", "category.category_code")}`;
