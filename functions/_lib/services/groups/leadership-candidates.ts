/**
 * Who may be given leadership of a group.
 *
 * Deliberately not the group's membership roster. A group whose participation
 * follows from affiliation rather than from a taken seat — the consortium's
 * All Members forum — has an empty roster and every active member as a
 * candidate, and reading the roster instead is what left its leadership picker
 * answering "no matches" for people the system knows (issue #26).
 */
import type {
  GroupLeadershipCandidate,
  GroupLeadershipCandidatesListQuery,
} from "../../../../assets/shared/schemas/groups";
import { GROUP_LEADERSHIP_CANDIDATE_SORT_COLUMNS } from "../../../../assets/shared/schemas/groups";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import {
  ALL_ACTIVE_USER_CAPACITIES_CTE,
  activeParentGroupMembershipPredicate,
  eligibleGroupCapacityPredicate,
} from "../membership/capacity-query";

interface LeadershipCandidateRow {
  user_id: string;
  identity_id: string;
  member_id: string;
  member_type: "individual" | "organization";
  first_name: string | null;
  last_name: string | null;
  email: string;
  organization_name: string | null;
  membership_category: string | null;
  participating: number;
}

function mapLeadershipCandidate(row: LeadershipCandidateRow): GroupLeadershipCandidate {
  return {
    userId: row.user_id,
    identityId: row.identity_id,
    memberId: row.member_id,
    memberType: row.member_type,
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    organizationName: row.organization_name,
    membershipCategory: (row.membership_category as GroupLeadershipCandidate["membershipCategory"]) ?? null,
    participating: row.participating === 1,
  };
}

const LEADERSHIP_CANDIDATE_SORT_EXPRESSIONS = {
  user_name: "LOWER(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, '') || ' ' || u.email)",
  organization_name: "LOWER(COALESCE(capacity.organization_name, ''))",
} satisfies Record<(typeof GROUP_LEADERSHIP_CANDIDATE_SORT_COLUMNS)[number], string>;

/**
 * Everyone the group's own eligibility rules would admit, seated or not.
 *
 * This is deliberately not the membership roster. A group whose participation
 * is implied by affiliation rather than taken as a seat — the consortium's All
 * Members forum — has an empty roster and every active member as a candidate,
 * and reading the roster is what made its leadership picker answer "no
 * matches" for people it knows (issue #26). The eligibility predicate is the
 * same one self-service joining uses, with managed groups allowed because the
 * caller here is a group manager, so the set a manager may appoint from is
 * exactly the set the group would accept.
 */
export function buildGroupLeadershipCandidatesPageQuery(
  groupId: string,
  query: GroupLeadershipCandidatesListQuery,
): OffsetPageQuery {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["u.first_name", "u.last_name", "u.email", "capacity.organization_name"])
    : null;
  const conditions = [
    eligibleGroupCapacityPredicate("g", "rule", "1"),
    activeParentGroupMembershipPredicate("g", "capacity.user_id"),
  ];
  const bindings: unknown[] = [groupId];
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const fromSql = `FROM active_user_capacities capacity
    JOIN users u ON u.id = capacity.user_id
    JOIN groups g ON g.id = ? AND g.active = 1
    LEFT JOIN group_membership_category_rules rule
      ON rule.group_id = g.id
     AND rule.membership_category_code = capacity.membership_category
   WHERE ${conditions.join(" AND ")}`;
  return {
    source: {
      withSql: ALL_ACTIVE_USER_CAPACITIES_CTE,
      selectSql: `SELECT capacity.user_id, capacity.identity_id, capacity.member_id, capacity.member_type,
              u.first_name, u.last_name, u.email, capacity.organization_name, capacity.membership_category,
              EXISTS (
                SELECT 1 FROM group_memberships seat
                 WHERE seat.group_id = g.id
                   AND seat.user_id = capacity.user_id
                   AND seat.identity_id = capacity.identity_id
                   AND seat.left_at IS NULL
              ) AS participating`,
      fromSql,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      LEADERSHIP_CANDIDATE_SORT_EXPRESSIONS,
      LEADERSHIP_CANDIDATE_SORT_EXPRESSIONS.user_name,
      "capacity.identity_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listGroupLeadershipCandidates(
  db: DatabaseLike,
  groupId: string,
  query: GroupLeadershipCandidatesListQuery,
): Promise<{ candidates: GroupLeadershipCandidate[]; total: number }> {
  const { rows, total } = await queryPage<LeadershipCandidateRow>(
    db,
    buildGroupLeadershipCandidatesPageQuery(groupId, query),
  );
  return { candidates: rows.map(mapLeadershipCandidate), total };
}
