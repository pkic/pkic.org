/**
 * Portal (authenticated member) vote queries and /api/v1/me/votes history —
 * Split out of votes.ts.
 */
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy, resolveOrderBy } from "../../db/sort";
import { parseJsonSafe } from "../../utils/json";
import { AppError } from "../../errors";
import { VOTING_CATEGORIES } from "../membership/applications/create";
import { resolveVotingDelegateUserId } from "./ballots";
import {
  toVoteSummary,
  getCandidates,
  getCandidatesForVotes,
  getVoteRowOrThrow,
  VOTE_ROW_COLUMNS,
  eligibleCategoriesOf,
  type VoteRow,
  type VoteType,
  type VoteScopeType,
  type VoteStatus,
  type VoteSummary,
  type CandidateSummary,
  type VoteFullResult,
  type VoteResult,
} from "./shared";
import type { AuthMember, DatabaseLike } from "../../types";
import { VOTES_LIST_SORT_COLUMNS } from "../../../../assets/shared/schemas/votes";

export interface PortalVoteSummary extends VoteSummary {
  candidates: CandidateSummary[] | null;
  canCastBallot: boolean;
  hasCastBallot: boolean;
  result: VoteResult;
}

async function memberCanCastBallot(db: DatabaseLike, vote: VoteRow, member: AuthMember): Promise<boolean> {
  if (vote.status !== "open") return false;
  if (!VOTING_CATEGORIES.has(member.membershipCategory)) return false;
  const restriction = eligibleCategoriesOf(vote);
  if (restriction && !restriction.includes(member.membershipCategory)) return false;

  if (vote.scope_type === "forum") {
    if (!member.organizationId) return false;
    const delegateId = await resolveVotingDelegateUserId(db, member.organizationId);
    return delegateId === member.userId;
  }
  const membership = await first<{ id: string }>(
    db,
    `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
    [vote.scope_id, member.userId],
  );
  return Boolean(membership);
}

async function memberHasCastBallot(db: DatabaseLike, vote: VoteRow, member: AuthMember): Promise<boolean> {
  if (vote.scope_type === "forum") {
    if (!member.organizationId) return false;
    const row = await first<{ id: string }>(
      db,
      `SELECT id FROM vote_ballots WHERE vote_id = ? AND organization_id = ? AND round = ?`,
      [vote.id, member.organizationId, vote.current_round],
    );
    return Boolean(row);
  }
  const row = await first<{ id: string }>(
    db,
    `SELECT id FROM vote_ballots WHERE vote_id = ? AND user_id = ? AND round = ? AND organization_id IS NULL`,
    [vote.id, member.userId, vote.current_round],
  );
  return Boolean(row);
}

async function toPortalVoteSummary(db: DatabaseLike, row: VoteRow, member: AuthMember): Promise<PortalVoteSummary> {
  const summary = toVoteSummary(row);
  const candidates = row.vote_type === "election" ? await getCandidates(db, row.id) : null;
  const canCastBallot = await memberCanCastBallot(db, row, member);
  const hasCastBallot = await memberHasCastBallot(db, row, member);
  const result =
    row.status === "closed"
      ? (parseJsonSafe<Record<string, unknown>>(row.result_json, {}) as unknown as VoteResult)
      : null;
  return { ...summary, candidates, canCastBallot, hasCastBallot, result };
}

/**
 * Whether the member can cast a ballot for `vote`, given precomputed
 * per-request values (their resolved forum voting delegate and the set of
 * working groups they belong to) instead of a fresh query per vote — the
 * eligibility checks below intentionally mirror memberCanCastBallot's,
 * since that async/per-row version stays in use by the single-vote detail
 * endpoint, where a query-per-vote isn't an N+1 concern.
 */
function canCastBallotForList(
  vote: VoteRow,
  member: AuthMember,
  delegateUserId: string | null,
  wgIds: ReadonlySet<string>,
): boolean {
  if (vote.status !== "open") return false;
  if (!VOTING_CATEGORIES.has(member.membershipCategory)) return false;
  const restriction = eligibleCategoriesOf(vote);
  if (restriction && !restriction.includes(member.membershipCategory)) return false;

  if (vote.scope_type === "forum") {
    return Boolean(member.organizationId) && delegateUserId === member.userId;
  }
  return vote.scope_id ? wgIds.has(vote.scope_id) : false;
}

/** Bulk-loads which (vote, round) pairs the member has already cast a ballot for, in one query instead of one per vote. */
async function loadCastBallotRounds(db: DatabaseLike, voteIds: string[], member: AuthMember): Promise<Set<string>> {
  if (voteIds.length === 0) return new Set();
  const voteFilter = buildD1JsonMembershipFilter("vote_id", voteIds);
  const memberConditions = ["(user_id = ? AND organization_id IS NULL)"];
  const memberArgs: unknown[] = [member.userId];
  if (member.organizationId) {
    memberConditions.push("(organization_id = ?)");
    memberArgs.push(member.organizationId);
  }
  const rows = await all<{ vote_id: string; round: number }>(
    db,
    `SELECT vote_id, round FROM vote_ballots WHERE ${voteFilter.sql} AND (${memberConditions.join(" OR ")})`,
    [...voteFilter.bindings, ...memberArgs],
  );
  return new Set(rows.map((r) => `${r.vote_id}:${r.round}`));
}

/** Votes visible to a member: public ones, plus every WG they belong to, plus every forum vote. */
export async function listVisibleVotesForMember(
  db: DatabaseLike,
  member: AuthMember,
  params: { limit: number; offset: number; status?: VoteStatus[]; q?: string; sort?: string },
): Promise<{ votes: PortalVoteSummary[]; total: number }> {
  const wgRows = await all<{ working_group_id: string }>(
    db,
    `SELECT working_group_id FROM working_group_members WHERE user_id = ? AND left_at IS NULL`,
    [member.userId],
  );
  const wgIds = new Set(wgRows.map((r) => r.working_group_id));

  const conditions = ["(scope_type = 'forum' OR visibility = 'public')"];
  const args: unknown[] = [];
  if (wgIds.size > 0) {
    const workingGroupFilter = buildD1JsonMembershipFilter("scope_id", [...wgIds]);
    conditions.push(`OR (scope_type = 'working_group' AND ${workingGroupFilter.sql})`);
    args.push(...workingGroupFilter.bindings);
  }
  const filters = [`(${conditions.join(" ")})`];
  if (params.status && params.status.length > 0) {
    const statusFilter = buildD1JsonMembershipFilter("status", params.status);
    filters.push(statusFilter.sql);
    args.push(...statusFilter.bindings);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["title", "description", "status", "vote_type", "scope_type"]);
    filters.push(search.sql);
    args.push(...search.bindings);
  }
  const where = filters.join(" AND ");
  const orderBy = resolveOrderBy(params.sort, VOTES_LIST_SORT_COLUMNS, "ORDER BY closes_at DESC", "id ASC");

  const { rows, total } = await queryPage<VoteRow>(
    db,
    {
      sql: `SELECT ${VOTE_ROW_COLUMNS} FROM votes WHERE ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...args, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM votes WHERE ${where}`, bindings: args },
  );

  if (rows.length === 0) return { votes: [], total };

  const voteIds = rows.map((r) => r.id);
  const electionVoteIds = rows.filter((r) => r.vote_type === "election").map((r) => r.id);

  const [candidatesByVoteId, delegateUserId, castBallotRounds] = await Promise.all([
    getCandidatesForVotes(db, electionVoteIds),
    member.organizationId ? resolveVotingDelegateUserId(db, member.organizationId) : Promise.resolve(null),
    loadCastBallotRounds(db, voteIds, member),
  ]);

  const votes = rows.map((row) => {
    const summary = toVoteSummary(row);
    const result =
      row.status === "closed"
        ? (parseJsonSafe<Record<string, unknown>>(row.result_json, {}) as unknown as VoteResult)
        : null;
    return {
      ...summary,
      candidates: row.vote_type === "election" ? (candidatesByVoteId.get(row.id) ?? []) : null,
      canCastBallot: canCastBallotForList(row, member, delegateUserId, wgIds),
      hasCastBallot: castBallotRounds.has(`${row.id}:${row.current_round}`),
      result,
    };
  });

  return { votes, total };
}

export async function getVoteDetailForMember(
  db: DatabaseLike,
  member: AuthMember,
  voteIdOrSlug: string,
): Promise<PortalVoteSummary> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (row.scope_type === "working_group" && row.visibility !== "public") {
    const membership = await first<{ id: string }>(
      db,
      `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
      [row.scope_id, member.userId],
    );
    if (!membership) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  }
  return toPortalVoteSummary(db, row, member);
}

export async function getVoteResultsForMember(db: DatabaseLike, voteIdOrSlug: string): Promise<VoteFullResult> {
  const row = await getVoteRowOrThrow(db, voteIdOrSlug);
  if (row.status !== "closed") {
    throw new AppError(409, "VOTE_NOT_CLOSED", "Results are hidden until the vote closes");
  }
  return parseJsonSafe<Record<string, unknown>>(row.result_json, {}) as unknown as VoteFullResult;
}

// ── /api/v1/me/votes, replaces the old stub ─────────────

export interface MyVoteHistoryEntry {
  voteId: string;
  slug: string;
  title: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  status: VoteStatus;
  choice: string;
  submittedAt: string;
}

export async function listMyVoteHistory(
  db: DatabaseLike,
  member: AuthMember,
  params: { limit: number; offset: number; q?: string; sort?: string },
): Promise<{ votes: MyVoteHistoryEntry[]; total: number }> {
  const conditions = ["b.user_id = ?"];
  const bindings: unknown[] = [member.userId];
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "v.title",
      "v.status",
      "v.vote_type",
      "v.scope_type",
      "b.choice",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.join(" AND ");
  const orderBy = resolveMappedOrderBy(
    params.sort,
    { title: "v.title COLLATE NOCASE", status: "v.status", submittedAt: "b.submitted_at" },
    "b.submitted_at DESC",
    "b.id ASC",
  );
  const { rows, total } = await queryPage<{
    vote_id: string;
    slug: string;
    title: string;
    vote_type: VoteType;
    scope_type: VoteScopeType;
    status: VoteStatus;
    choice: string;
    submitted_at: string;
  }>(
    db,
    {
      sql: `SELECT b.vote_id, v.slug, v.title, v.vote_type, v.scope_type, v.status, b.choice, b.submitted_at
       FROM vote_ballots b JOIN votes v ON v.id = b.vote_id
       WHERE ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...bindings, params.limit, params.offset],
    },
    {
      sql: `SELECT COUNT(*) AS total FROM vote_ballots b JOIN votes v ON v.id = b.vote_id WHERE ${where}`,
      bindings,
    },
  );
  const votes = rows.map((r) => ({
    voteId: r.vote_id,
    slug: r.slug,
    title: r.title,
    voteType: r.vote_type,
    scopeType: r.scope_type,
    status: r.status,
    choice: r.choice,
    submittedAt: r.submitted_at,
  }));
  return { votes, total };
}
