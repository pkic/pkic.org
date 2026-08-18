/**
 * Public (no auth) vote queries — "Votes (public — no auth required)".
 * Split out of votes.ts.
 */
import { all, first } from "../../db/queries";
import { parseJsonSafe } from "../../utils/json";
import { AppError } from "../../errors";
import { getWorkingGroupBySlugOrId } from "../working-groups";
import {
  toVoteSummary,
  getCandidates,
  type VoteRow,
  type VoteType,
  type VoteScopeType,
  type VoteSummary,
  type CandidateSummary,
  type VoteResult,
} from "./shared";
import type { DatabaseLike } from "../../types";

export interface PublicVoteListParams {
  type?: VoteType;
  scope?: VoteScopeType;
  wg?: string;
  status?: "open" | "closed";
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
  sort?: "closes_at" | "created_at";
}

export interface PublicVoteSummary extends VoteSummary {
  candidates: CandidateSummary[] | null;
  result: VoteResult;
}

function publicResultForDetailLevel(row: VoteRow): VoteResult {
  if (row.status !== "closed" || !row.result_json) return null;
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
  return { ...summary, candidates, result };
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
  if (params.scope) {
    conditions.push("scope_type = ?");
    args.push(params.scope);
  }
  if (params.wg) {
    const wg = await getWorkingGroupBySlugOrId(db, params.wg);
    conditions.push("scope_id = ?");
    args.push(wg?.id ?? "__none__");
  }
  if (params.status === "open") {
    conditions.push("status = 'open'");
  } else if (params.status === "closed") {
    conditions.push("status = 'closed'");
  }
  if (params.from) {
    conditions.push("closes_at >= ?");
    args.push(params.from);
  }
  if (params.to) {
    conditions.push("closes_at <= ?");
    args.push(params.to);
  }

  const sortColumn = params.sort === "created_at" ? "created_at" : "closes_at";
  const perPage = Math.min(Math.max(params.perPage ?? 20, 1), 100);
  const page = Math.max(params.page ?? 1, 1);
  const offset = (page - 1) * perPage;

  const where = conditions.join(" AND ");
  const rows = await all<VoteRow>(
    db,
    `SELECT * FROM votes WHERE ${where} ORDER BY ${sortColumn} DESC LIMIT ? OFFSET ?`,
    [...args, perPage, offset],
  );
  const totalRow = await first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM votes WHERE ${where}`, args);

  const votes = await Promise.all(rows.map((r) => toPublicVoteSummary(db, r)));
  return { votes, total: totalRow?.total ?? 0 };
}

export async function getPublicVoteBySlug(db: DatabaseLike, slug: string): Promise<PublicVoteSummary> {
  const row = await first<VoteRow>(db, `SELECT * FROM votes WHERE slug = ? AND visibility = 'public'`, [slug]);
  if (!row) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return toPublicVoteSummary(db, row);
}

export async function listPublicVotesForFeed(db: DatabaseLike, limit = 50): Promise<PublicVoteSummary[]> {
  const rows = await all<VoteRow>(
    db,
    `SELECT * FROM votes WHERE visibility = 'public' ORDER BY closes_at DESC LIMIT ?`,
    [limit],
  );
  return Promise.all(rows.map((r) => toPublicVoteSummary(db, r)));
}
