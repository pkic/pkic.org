/**
 * Public (no auth) vote queries — "Votes (public — no auth required)".
 * Split out of votes.ts.
 */
import { nowIso } from "../../utils/time";
import { deriveVoteStatus, voteStatusSql, VOTE_LIFECYCLE_RANK_SQL } from "./status";
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { parseJsonSafe } from "../../utils/json";
import { AppError } from "../../errors";
import {
  toVoteSummary,
  getCandidates,
  getCandidatesForVotes,
  VOTE_ROW_COLUMNS,
  type VoteRow,
  type VoteResult,
} from "./shared";
import type { DatabaseLike } from "../../types";
import { VOTES_LIST_SORT_COLUMNS } from "../../../../assets/shared/schemas/votes";
import { publicVoteSchema, type PublicVotesListQuery } from "../../../../assets/shared/schemas/votes";
import type { z } from "zod";

export type PublicVoteListParams = PublicVotesListQuery;
export type PublicVoteSummary = z.infer<typeof publicVoteSchema>;

export function publicResultForDetailLevel(row: VoteRow, now: string = nowIso()): VoteResult {
  if (deriveVoteStatus(row, now) !== "closed" || !row.result_json) return null;
  const full = parseJsonSafe<Record<string, unknown>>(row.result_json, {});
  if (row.public_detail_level === "outcome_only") {
    return { outcome: (full.outcome as string | undefined) ?? (full.winnerCandidateId ? "decided" : null) };
  }
  // aggregate and full_breakdown (full_breakdown never contains voter
  // identities to begin with — result_json only stores counts, never
  // user_id — so "full_breakdown" and "aggregate" are equivalent here; the
  // distinction only matters for the staff-only raw ballots endpoint).
  return full as unknown as VoteResult;
}

async function toPublicVoteSummary(db: DatabaseLike, row: VoteRow): Promise<PublicVoteSummary> {
  const summary = toVoteSummary(row);
  const candidates = row.vote_type === "election" ? await getCandidates(db, row.id) : null;
  const result = publicResultForDetailLevel(row);
  return publicVoteSchema.parse({ ...summary, candidates, result });
}

async function toPublicVoteSummaries(db: DatabaseLike, rows: VoteRow[]): Promise<PublicVoteSummary[]> {
  const electionIds = rows.filter((row) => row.vote_type === "election").map((row) => row.id);
  const candidatesByVoteId = await getCandidatesForVotes(db, electionIds);
  return rows.map((row) =>
    publicVoteSchema.parse({
      ...toVoteSummary(row),
      candidates: row.vote_type === "election" ? (candidatesByVoteId.get(row.id) ?? []) : null,
      result: publicResultForDetailLevel(row),
    }),
  );
}

export async function listPublicVotes(
  db: DatabaseLike,
  params: PublicVoteListParams,
): Promise<{ votes: PublicVoteSummary[]; total: number }> {
  const conditions = ["visibility = 'public'"];
  const args: unknown[] = [];

  if (params.type) {
    conditions.push("vote_type = ?");
    args.push(params.type);
  }
  if (params.ownerGroupId) {
    conditions.push("owner_group_id = ?");
    args.push(params.ownerGroupId);
  }
  if (params.status && params.status.length > 0) {
    // Status is derived, so the filter carries the two instants its CASE needs.
    // They precede the membership binding because they appear first in the SQL.
    const statusNow = nowIso();
    const statusFilter = buildD1JsonMembershipFilter(voteStatusSql("votes"), params.status);
    conditions.push(statusFilter.sql);
    args.push(statusNow, statusNow, ...statusFilter.bindings);
  }
  if (params.from) {
    conditions.push("closes_at >= ?");
    args.push(params.from);
  }
  if (params.to) {
    conditions.push("closes_at <= ?");
    args.push(params.to);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["title", "description", "vote_type"]);
    conditions.push(search.sql);
    args.push(...search.bindings);
  }

  // Status is derived, and ORDER BY has no binding channel, so the status sort
  // orders by lifecycle stage — active, then closed, then cancelled — which
  // needs no reference to the current time.
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      title: "title COLLATE NOCASE",
      status: VOTE_LIFECYCLE_RANK_SQL,
      closes_at: "closes_at",
      created_at: "created_at",
    } satisfies Record<(typeof VOTES_LIST_SORT_COLUMNS)[number], string>,
    "closes_at DESC",
    "id ASC",
  );
  const { limit, offset } = params;

  const where = conditions.join(" AND ");
  const { rows, total } = await queryPage<VoteRow>(db, {
    sql: `SELECT ${VOTE_ROW_COLUMNS} FROM votes WHERE ${where}`,
    bindings: args,
    orderBy,
    limit,
    offset,
  });

  const votes = await toPublicVoteSummaries(db, rows);
  return { votes, total };
}

export async function getPublicVoteBySlug(db: DatabaseLike, slug: string): Promise<PublicVoteSummary> {
  const row = await first<VoteRow>(
    db,
    `SELECT ${VOTE_ROW_COLUMNS} FROM votes WHERE slug = ? AND visibility = 'public'`,
    [slug],
  );
  if (!row) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return toPublicVoteSummary(db, row);
}

export async function listPublicVotesForFeed(db: DatabaseLike, limit = 50): Promise<PublicVoteSummary[]> {
  const rows = await all<VoteRow>(
    db,
    `SELECT ${VOTE_ROW_COLUMNS} FROM votes WHERE visibility = 'public' ORDER BY closes_at DESC LIMIT ?`,
    [limit],
  );
  return toPublicVoteSummaries(db, rows);
}
