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
import { VOTING_CATEGORIES } from "../membership/applications/create";
import { getWorkingGroupBySlugOrId } from "../working-groups";
import type {
  VOTE_TYPES,
  VOTE_SCOPE_TYPES,
  THRESHOLD_TYPES,
  VOTE_STATUSES,
  VOTE_PROPOSAL_STATUSES,
  VOTE_VISIBILITIES,
  PUBLIC_DETAIL_LEVELS,
  BALLOT_CHOICES,
  voteFullResultSchema,
  voteResultSchema,
} from "../../../../assets/shared/schemas/votes";
import type { AuthMember, DatabaseLike } from "../../types";

// Derived from the canonical shared schema (assets/shared/schemas/votes.ts)
// rather than hand-duplicated, so the DB-facing service layer and the API
// response contract can never drift apart (PR #1 review §1.3).
export type VoteType = (typeof VOTE_TYPES)[number];
export type VoteScopeType = (typeof VOTE_SCOPE_TYPES)[number];
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
  scope_type: VoteScopeType;
  scope_id: string | null;
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
export const VOTE_ROW_COLUMNS =
  "id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id, " +
  "eligible_categories, threshold_type, opens_at, closes_at, current_round, transition_revision, " +
  "transition_processing_token, transition_lease_expires_at, status, result_json, visibility, public_detail_level, " +
  "created_at, updated_at";

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
  scopeType: VoteScopeType;
  scopeId: string | null;
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
    scopeType: row.scope_type,
    scopeId: row.scope_id,
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

export async function getCandidates(db: DatabaseLike, voteId: string): Promise<CandidateSummary[]> {
  const rows = await all<CandidateRow>(
    db,
    `SELECT * FROM vote_candidates WHERE vote_id = ? ORDER BY sort_order ASC, created_at ASC`,
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
    `SELECT * FROM vote_candidates WHERE ${voteFilter.sql} ORDER BY vote_id, sort_order ASC, created_at ASC`,
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

/**
 * Just enough to build a votes:manage permission context (WG-scoped vs
 * global) before mutating — admin route handlers call this first so a WG
 * chair's scoped grant is checked against the vote's actual working group.
 */
export async function getVoteScopeForPermissionCheck(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<{ scopeType: VoteScopeType; scopeId: string | null }> {
  const row = await getVoteRowOrThrow(db, idOrSlug);
  return { scopeType: row.scope_type, scopeId: row.scope_id };
}

export async function assertVotingCategory(member: AuthMember): Promise<void> {
  if (!VOTING_CATEGORIES.has(member.membershipCategory)) {
    throw new AppError(403, "H_CATEGORY_CANNOT_VOTE", "H-category members cannot cast a ballot");
  }
}

/** Resolves a working_group scopeId to its canonical id (or null for forum scope) — shared by direct vote creation and proposal submission. */
export async function resolveScope(
  db: DatabaseLike,
  scopeType: VoteScopeType,
  scopeId?: string | null,
): Promise<string | null> {
  if (scopeType === "forum") return null;
  if (!scopeId) throw new AppError(422, "SCOPE_ID_REQUIRED", "scopeId is required for working_group-scoped votes");
  const wg = await getWorkingGroupBySlugOrId(db, scopeId);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  return wg.id;
}
