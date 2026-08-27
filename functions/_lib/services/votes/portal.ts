/** Portal vote discovery, detail, results, and the caller's ballot history. */
import { all } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy, resolveOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import { canMemberAccessGroupResource } from "../resource-grants/access";
import { votingMembershipCategoryExistsSql } from "../membership/categories";
import {
  closedVoteResult,
  getCandidatesForVotes,
  getVoteRowOrThrow,
  toVoteSummary,
  VOTE_ROW_COLUMNS,
  type CandidateSummary,
  type VoteFullResult,
  type VoteResult,
  type VoteRow,
  type VoteStatus,
  type VoteSummary,
  type VoteType,
} from "./shared";
import { publicResultForDetailLevel } from "./public";
import {
  exactVoteGroupMembership,
  voteParticipationGroupPredicate,
  voteResultGroupPredicate,
  voteViewGroupPredicate,
} from "./vote-access";
import type { AuthMember, DatabaseLike } from "../../types";
import type { MyVotesListQuery } from "../../../../assets/shared/schemas/me";
import { VOTES_LIST_SORT_COLUMNS, type PortalVotesListQuery } from "../../../../assets/shared/schemas/votes";

export interface EligibleMemberBallot {
  memberId: string;
  organizationName: string;
  hasCastBallot: boolean;
}

export interface PortalVoteSummary extends VoteSummary {
  candidates: CandidateSummary[] | null;
  canCastBallot: boolean;
  hasCastBallot: boolean;
  memberBallots: EligibleMemberBallot[] | null;
  result: VoteResult;
}

interface PersonBallotStatus {
  eligible: boolean;
  hasCastBallot: boolean;
}

async function loadAccessibleVoteIds(
  db: DatabaseLike,
  voteIds: string[],
  userId: string,
  throughGroupId?: string,
): Promise<Set<string>> {
  if (voteIds.length === 0) return new Set();
  const context = exactVoteGroupMembership(throughGroupId);
  const filter = buildD1JsonMembershipFilter("vote.id", voteIds);
  const rows = await all<{ vote_id: string }>(
    db,
    `SELECT DISTINCT vote.id AS vote_id
     FROM votes vote
     JOIN group_memberships membership
       ON membership.user_id = ?
      AND membership.left_at IS NULL
      ${context.sql}
      AND ${voteResultGroupPredicate("vote", "membership.group_id")}
     WHERE ${filter.sql}`,
    [userId, ...context.bindings, ...filter.bindings],
  );
  return new Set(rows.map((row) => row.vote_id));
}

async function loadEligibleMemberBallots(
  db: DatabaseLike,
  voteIds: string[],
  userId: string,
  throughGroupId?: string,
): Promise<Map<string, EligibleMemberBallot[]>> {
  const byVoteId = new Map<string, EligibleMemberBallot[]>();
  if (voteIds.length === 0) return byVoteId;
  const context = exactVoteGroupMembership(throughGroupId);
  const filter = buildD1JsonMembershipFilter("vote.id", voteIds);
  const rows = await all<{
    vote_id: string;
    member_id: string;
    organization_name: string;
    ballot_id: string | null;
  }>(
    db,
    `SELECT DISTINCT vote.id AS vote_id, membership.member_id,
            organization.name AS organization_name, ballot.id AS ballot_id
     FROM votes vote
     JOIN group_memberships membership
       ON membership.user_id = ?
      AND membership.left_at IS NULL
      ${context.sql}
      AND ${voteParticipationGroupPredicate("vote", "membership.group_id")}
     JOIN members represented_member
       ON represented_member.id = membership.member_id
      AND represented_member.status = 'active'
      AND represented_member.organization_id IS NOT NULL
     JOIN organizations organization ON organization.id = represented_member.organization_id
     JOIN member_category_assignments category ON category.member_id = represented_member.id
     JOIN organization_representatives representative
       ON representative.member_id = represented_member.id
      AND representative.user_id = membership.user_id
      AND representative.left_at IS NULL
      AND representative.blocked_at IS NULL
     LEFT JOIN vote_ballots ballot
       ON ballot.vote_id = vote.id
      AND ballot.member_id = membership.member_id
      AND ballot.round = vote.current_round
     WHERE vote.electorate_mode = 'per_member'
       AND ${filter.sql}
       AND ${votingMembershipCategoryExistsSql("category.category_code")}
       AND (
         vote.eligible_categories IS NULL
         OR EXISTS (
           SELECT 1 FROM json_each(vote.eligible_categories) allowed
           WHERE allowed.value = category.category_code
         )
       )
     ORDER BY vote.id, organization.name COLLATE NOCASE, membership.member_id`,
    [userId, ...context.bindings, ...filter.bindings],
  );
  for (const row of rows) {
    const ballots = byVoteId.get(row.vote_id) ?? [];
    ballots.push({
      memberId: row.member_id,
      organizationName: row.organization_name,
      hasCastBallot: row.ballot_id !== null,
    });
    byVoteId.set(row.vote_id, ballots);
  }
  return byVoteId;
}

async function loadPersonBallotStatuses(
  db: DatabaseLike,
  voteIds: string[],
  userId: string,
  throughGroupId?: string,
): Promise<Map<string, PersonBallotStatus>> {
  const result = new Map<string, PersonBallotStatus>();
  if (voteIds.length === 0) return result;
  const context = exactVoteGroupMembership(throughGroupId);
  const filter = buildD1JsonMembershipFilter("vote.id", voteIds);
  const rows = await all<{ vote_id: string; ballot_id: string | null }>(
    db,
    `SELECT vote.id AS vote_id, MAX(ballot.id) AS ballot_id
     FROM votes vote
     JOIN group_memberships membership
       ON membership.user_id = ?
      AND membership.left_at IS NULL
      ${context.sql}
      AND ${voteParticipationGroupPredicate("vote", "membership.group_id")}
     JOIN members represented_member
       ON represented_member.id = membership.member_id
      AND represented_member.status = 'active'
     JOIN member_category_assignments category
       ON category.member_id = represented_member.id
     LEFT JOIN vote_ballots ballot
       ON ballot.vote_id = vote.id
      AND ballot.user_id = ?
      AND ballot.member_id IS NULL
      AND ballot.round = vote.current_round
     WHERE vote.electorate_mode = 'per_person'
       AND ${filter.sql}
       AND ${votingMembershipCategoryExistsSql("category.category_code")}
       AND (
         vote.eligible_categories IS NULL
         OR EXISTS (
           SELECT 1 FROM json_each(vote.eligible_categories) allowed
           WHERE allowed.value = category.category_code
         )
       )
     GROUP BY vote.id`,
    [userId, ...context.bindings, userId, ...filter.bindings],
  );
  for (const row of rows) result.set(row.vote_id, { eligible: true, hasCastBallot: row.ballot_id !== null });
  return result;
}

export async function hydrateVotesForUser(
  db: DatabaseLike,
  rows: VoteRow[],
  userId: string,
  throughGroupId?: string,
): Promise<PortalVoteSummary[]> {
  if (rows.length === 0) return [];
  const voteIds = rows.map((row) => row.id);
  const electionVoteIds = rows.filter((row) => row.vote_type === "election").map((row) => row.id);
  const [candidatesByVoteId, memberBallotsByVoteId, personStatuses, accessibleVoteIds] = await Promise.all([
    getCandidatesForVotes(db, electionVoteIds),
    loadEligibleMemberBallots(db, voteIds, userId, throughGroupId),
    loadPersonBallotStatuses(db, voteIds, userId, throughGroupId),
    loadAccessibleVoteIds(db, voteIds, userId, throughGroupId),
  ]);

  return rows.map((row) => {
    const open = row.status === "open";
    const memberBallots = row.electorate_mode === "per_member" ? (memberBallotsByVoteId.get(row.id) ?? []) : null;
    const personStatus = personStatuses.get(row.id) ?? { eligible: false, hasCastBallot: false };
    const canCastBallot = open && (memberBallots ? memberBallots.length > 0 : personStatus.eligible);
    const hasCastBallot = memberBallots
      ? memberBallots.some((ballot) => ballot.hasCastBallot)
      : personStatus.hasCastBallot;
    const result =
      row.status !== "closed"
        ? null
        : accessibleVoteIds.has(row.id)
          ? closedVoteResult(row)
          : row.visibility === "public"
            ? publicResultForDetailLevel(row)
            : null;
    return {
      ...toVoteSummary(row),
      candidates: row.vote_type === "election" ? (candidatesByVoteId.get(row.id) ?? []) : null,
      canCastBallot,
      hasCastBallot,
      memberBallots,
      result,
    };
  });
}

/** Votes visible publicly or through membership in an owner/grantee group. */
export async function listVisibleVotesForMember(
  db: DatabaseLike,
  member: AuthMember,
  params: PortalVotesListQuery,
): Promise<{ votes: PortalVoteSummary[]; total: number }> {
  const filters = [
    `(votes.visibility = 'public' OR EXISTS (
       SELECT 1
       FROM group_memberships membership
       WHERE membership.user_id = ?
         AND membership.left_at IS NULL
         AND ${voteViewGroupPredicate("votes", "membership.group_id")}
     ))`,
  ];
  const bindings: unknown[] = [member.userId];
  if (params.status && params.status.length > 0) {
    const statusFilter = buildD1JsonMembershipFilter("status", params.status);
    filters.push(statusFilter.sql);
    bindings.push(...statusFilter.bindings);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["title", "description", "status", "vote_type"]);
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const orderBy = resolveOrderBy(params.sort, VOTES_LIST_SORT_COLUMNS, "ORDER BY closes_at DESC", "id ASC");
  const { rows, total } = await queryPage<VoteRow>(db, {
    sql: `SELECT ${VOTE_ROW_COLUMNS} FROM votes WHERE ${filters.join(" AND ")}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return { votes: await hydrateVotesForUser(db, rows, member.userId), total };
}

export async function getVoteDetailForMember(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
): Promise<PortalVoteSummary> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (row.visibility !== "public" && !(await canMemberAccessGroupResource(db, member.userId, "vote", row.id, "view"))) {
    throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  }
  return (await hydrateVotesForUser(db, [row], member.userId))[0];
}

export async function getVoteResultsForMember(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
): Promise<VoteFullResult> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (!(await canMemberAccessGroupResource(db, member.userId, "vote", row.id, "view_results"))) {
    throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  }
  return closedVoteResult(row);
}

export interface MyVoteHistoryEntry {
  voteId: string;
  slug: string;
  title: string;
  voteType: VoteType;
  ownerGroupId: string;
  memberId: string | null;
  status: VoteStatus;
  choice: string;
  submittedAt: string;
}

export async function listMyVoteHistory(
  db: DatabaseLike,
  member: AuthMember,
  params: MyVotesListQuery,
): Promise<{ votes: MyVoteHistoryEntry[]; total: number }> {
  const conditions = ["b.user_id = ?"];
  const bindings: unknown[] = [member.userId];
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["v.title", "v.status", "v.vote_type", "b.choice"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const orderBy = resolveMappedOrderBy(
    params.sort,
    { title: "v.title COLLATE NOCASE", status: "v.status", submittedAt: "b.updated_at" },
    "b.updated_at DESC",
    "b.id ASC",
  );
  const { rows, total } = await queryPage<{
    vote_id: string;
    slug: string;
    title: string;
    vote_type: VoteType;
    owner_group_id: string;
    member_id: string | null;
    status: VoteStatus;
    choice: string;
    submitted_at: string;
  }>(db, {
    sql: `SELECT b.vote_id, v.slug, v.title, v.vote_type, v.owner_group_id,
                 b.member_id, v.status, b.choice, b.updated_at AS submitted_at
          FROM vote_ballots b
          JOIN votes v ON v.id = b.vote_id
          WHERE ${conditions.join(" AND ")}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return {
    votes: rows.map((row) => ({
      voteId: row.vote_id,
      slug: row.slug,
      title: row.title,
      voteType: row.vote_type,
      ownerGroupId: row.owner_group_id,
      memberId: row.member_id,
      status: row.status,
      choice: row.choice,
      submittedAt: row.submitted_at,
    })),
    total,
  };
}
