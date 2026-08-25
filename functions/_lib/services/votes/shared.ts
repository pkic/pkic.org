/**
 * Voting system — shared types and repository/read-
 * model primitives used across the other votes/*.ts modules (lifecycle,
 * ballots, closing, public, portal, proposals). Split out of a single
 * 1400+ line votes.ts (PR #1 review) — see votes/index.ts for the barrel
 * that re-exports everything under the original module surface.
 */
import type { z } from "zod";
import { all, first } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { parseJsonSafe } from "../../utils/json";
import { AppError } from "../../errors";
import { getGroup } from "../groups/read-model";
import type {
  VOTE_TYPES,
  VOTE_ELECTORATE_MODES,
  THRESHOLD_TYPES,
  VOTE_STATUSES,
  VOTE_PROPOSAL_STATUSES,
  VOTE_VISIBILITIES,
  PUBLIC_DETAIL_LEVELS,
  BALLOT_CHOICES,
  voteFullResultSchema,
  voteResultSchema,
} from "../../../../assets/shared/schemas/votes";
import type { DatabaseLike } from "../../types";

// Derived from the canonical shared schema (assets/shared/schemas/votes.ts)
// rather than hand-duplicated, so the DB-facing service layer and the API
// response contract can never drift apart (PR #1 review §1.3).
export type VoteType = (typeof VOTE_TYPES)[number];
export type VoteElectorateMode = (typeof VOTE_ELECTORATE_MODES)[number];
export type ThresholdType = (typeof THRESHOLD_TYPES)[number];
export type VoteStatus = (typeof VOTE_STATUSES)[number];
export type VoteProposalStatus = (typeof VOTE_PROPOSAL_STATUSES)[number];
export type VoteVisibility = (typeof VOTE_VISIBILITIES)[number];
export type PublicDetailLevel = (typeof PUBLIC_DETAIL_LEVELS)[number];
export type BallotChoice = (typeof BALLOT_CHOICES)[number];
export type VoteFullResult = z.infer<typeof voteFullResultSchema>;
export type VoteResult = z.infer<typeof voteResultSchema>;

export const MOTION_CHOICES = new Set<BallotChoice>(["in_favor", "opposed", "abstain"]);

export interface VoteRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  vote_type: VoteType;
  owner_group_id: string;
  owner_group_name: string;
  electorate_mode: VoteElectorateMode;
  created_by_user_id: string | null;
  proposed_by_user_id: string | null;
  eligible_categories: string | null;
  threshold_type: ThresholdType;
  opens_at: string;
  closes_at: string;
  current_round: number;
  transition_revision: number;
  transition_processing_token: string | null;
  transition_lease_expires_at: string | null;
  status: VoteStatus;
  result_json: string | null;
  visibility: VoteVisibility;
  public_detail_level: PublicDetailLevel;
  created_at: string;
  updated_at: string;
}

/** Canonical explicit projection for every query that hydrates a complete VoteRow. */
export function voteRowProjection(alias: "votes" | "vote"): string {
  return `${alias}.id, ${alias}.slug, ${alias}.title, ${alias}.description, ${alias}.vote_type,
    ${alias}.owner_group_id,
    (SELECT name FROM groups owner_group WHERE owner_group.id = ${alias}.owner_group_id) AS owner_group_name,
    ${alias}.electorate_mode, ${alias}.created_by_user_id, ${alias}.proposed_by_user_id,
    ${alias}.eligible_categories, ${alias}.threshold_type, ${alias}.opens_at, ${alias}.closes_at,
    ${alias}.current_round, ${alias}.transition_revision, ${alias}.transition_processing_token,
    ${alias}.transition_lease_expires_at, ${alias}.status, ${alias}.result_json, ${alias}.visibility,
    ${alias}.public_detail_level, ${alias}.created_at, ${alias}.updated_at`;
}

export const VOTE_ROW_COLUMNS = voteRowProjection("votes");

export interface CandidateRow {
  id: string;
  vote_id: string;
  user_id: string | null;
  candidate_name: string;
  candidate_bio: string | null;
  nominated_by_user_id: string | null;
  sort_order: number;
  eliminated_round: number | null;
  created_at: string;
}

export const VOTE_CANDIDATE_COLUMNS =
  "id, vote_id, user_id, candidate_name, candidate_bio, nominated_by_user_id, sort_order, eliminated_round, created_at";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function uniqueSlug(db: DatabaseLike, title: string): Promise<string> {
  const base = slugify(title) || "vote";
  let candidate = base;
  let suffix = 2;
  // Bounded by the number of collisions actually found — no realistic vote
  // titling scheme produces more than a handful.
  while (await first<{ id: string }>(db, `SELECT id FROM votes WHERE slug = ?`, [candidate])) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function eligibleCategoriesOf(row: VoteRow): string[] | null {
  const parsed = parseJsonSafe<string[] | null>(row.eligible_categories, null);
  return parsed;
}

export interface CandidateSummary {
  id: string;
  userId: string | null;
  candidateName: string;
  candidateBio: string | null;
  sortOrder: number;
  eliminatedRound: number | null;
}

export function toCandidateSummary(row: CandidateRow): CandidateSummary {
  return {
    id: row.id,
    userId: row.user_id,
    candidateName: row.candidate_name,
    candidateBio: row.candidate_bio,
    sortOrder: row.sort_order,
    eliminatedRound: row.eliminated_round,
  };
}

export interface VoteSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  voteType: VoteType;
  ownerGroupId: string;
  ownerGroupName: string;
  electorateMode: VoteElectorateMode;
  thresholdType: ThresholdType;
  eligibleCategories: string[] | null;
  opensAt: string;
  closesAt: string;
  currentRound: number;
  status: VoteStatus;
  visibility: VoteVisibility;
  publicDetailLevel: PublicDetailLevel;
  createdAt: string;
  updatedAt: string;
}

export function toVoteSummary(row: VoteRow): VoteSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    voteType: row.vote_type,
    ownerGroupId: row.owner_group_id,
    ownerGroupName: row.owner_group_name,
    electorateMode: row.electorate_mode,
    thresholdType: row.threshold_type,
    eligibleCategories: eligibleCategoriesOf(row),
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    currentRound: row.current_round,
    status: row.status,
    visibility: row.visibility,
    publicDetailLevel: row.public_detail_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function closedVoteResult(row: VoteRow): VoteFullResult {
  if (row.status !== "closed") {
    throw new AppError(409, "VOTE_NOT_CLOSED", "Results are hidden until the vote closes");
  }
  return parseJsonSafe<Record<string, unknown>>(row.result_json, {}) as unknown as VoteFullResult;
}

export async function getCandidates(db: DatabaseLike, voteId: string): Promise<CandidateSummary[]> {
  const rows = await all<CandidateRow>(
    db,
    `SELECT ${VOTE_CANDIDATE_COLUMNS} FROM vote_candidates WHERE vote_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [voteId],
  );
  return rows.map(toCandidateSummary);
}

/** Bulk-loads candidates for several votes in one query instead of one query per vote — used by listVotesForAdmin. */
export async function getCandidatesForVotes(
  db: DatabaseLike,
  voteIds: string[],
): Promise<Map<string, CandidateSummary[]>> {
  const byVoteId = new Map<string, CandidateSummary[]>();
  if (voteIds.length === 0) return byVoteId;

  const voteFilter = buildD1JsonMembershipFilter("vote_id", voteIds);
  const rows = await all<CandidateRow>(
    db,
    `SELECT ${VOTE_CANDIDATE_COLUMNS}
     FROM vote_candidates
     WHERE ${voteFilter.sql}
     ORDER BY vote_id, sort_order ASC, created_at ASC`,
    voteFilter.bindings,
  );
  for (const row of rows) {
    const list = byVoteId.get(row.vote_id) ?? [];
    list.push(toCandidateSummary(row));
    byVoteId.set(row.vote_id, list);
  }
  return byVoteId;
}

export async function getVoteRowOrThrow(db: DatabaseLike, idOrSlug: string): Promise<VoteRow> {
  const row = await first<VoteRow>(db, `SELECT ${VOTE_ROW_COLUMNS} FROM votes WHERE id = ? OR slug = ?`, [
    idOrSlug,
    idOrSlug,
  ]);
  if (!row) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");
  return row;
}

/** Resolve and validate the canonical owning group shared by votes and proposals. */
export async function resolveVoteOwnerGroup(db: DatabaseLike, ownerGroupId: string): Promise<string> {
  const group = await getGroup(db, ownerGroupId);
  if (!group || !group.active) throw new AppError(404, "GROUP_NOT_FOUND", "Owning group not found");
  return group.id;
}
