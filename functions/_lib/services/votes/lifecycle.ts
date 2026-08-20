/**
 * Direct vote creation (staff admin or WG chair), settings/
 * visibility updates, and the admin list/ballot-audit queries. Split out of
 * votes.ts.
 */
import { all, run } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { stringifyJson } from "../../utils/json";
import { AppError } from "../../errors";
import { resolveOrderBy } from "../../db/sort";
import {
  resolveScope,
  uniqueSlug,
  toVoteSummary,
  getVoteRowOrThrow,
  getCandidatesForVotes,
  type VoteRow,
  type VoteType,
  type VoteScopeType,
  type ThresholdType,
  type VoteStatus,
  type VoteVisibility,
  type PublicDetailLevel,
  type VoteSummary,
  type CandidateSummary,
} from "./shared";
import type { AuthAdmin, DatabaseLike } from "../../types";

export interface CreateVoteInput {
  title: string;
  description?: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId?: string | null;
  thresholdType: ThresholdType;
  eligibleCategories?: string[] | null;
  opensAt?: string;
  closesAt: string;
  candidates?: { name: string; bio?: string; userId?: string | null }[];
}

function validateThresholdForType(voteType: VoteType, thresholdType: ThresholdType, candidateCount: number): void {
  if (voteType === "election") {
    if (thresholdType === "successive_elimination" && candidateCount < 3) {
      throw new AppError(
        422,
        "INVALID_THRESHOLD",
        "successive_elimination requires at least 3 candidates; use simple_majority for 2-candidate elections",
      );
    }
    if (thresholdType === "supermajority") {
      throw new AppError(422, "INVALID_THRESHOLD", "supermajority does not apply to elections");
    }
  } else if (thresholdType === "successive_elimination") {
    throw new AppError(422, "INVALID_THRESHOLD", "successive_elimination only applies to elections");
  }
}

export async function createVoteDirect(
  db: DatabaseLike,
  admin: AuthAdmin,
  input: CreateVoteInput,
): Promise<VoteSummary> {
  const scopeId = await resolveScope(db, input.scopeType, input.scopeId);
  const candidates = input.voteType === "election" ? (input.candidates ?? []) : [];
  if (input.voteType === "election" && candidates.length < 2) {
    throw new AppError(422, "CANDIDATES_REQUIRED", "Election votes require at least 2 candidates");
  }
  validateThresholdForType(input.voteType, input.thresholdType, candidates.length);

  const now = nowIso();
  const opensAt = input.opensAt ?? now;
  if (new Date(input.closesAt).getTime() <= new Date(opensAt).getTime()) {
    throw new AppError(422, "INVALID_WINDOW", "closesAt must be after opensAt");
  }

  const id = uuid();
  const slug = await uniqueSlug(db, input.title);
  const status: VoteStatus = new Date(opensAt).getTime() <= Date.now() ? "open" : "scheduled";

  // Build every statement first, execute once via db.batch() — the vote row
  // and its candidates are one atomic unit of work (PR #1 review §5.3): a
  // constraint failure on any candidate insert must not leave a vote row
  // committed with no candidates (or only some), visible to concurrent
  // reads, or a slug a retry then collides with.
  const statements = [
    db
      .prepare(
        `INSERT INTO votes
           (id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id,
            eligible_categories, threshold_type, opens_at, closes_at, current_round, status, result_json,
            visibility, public_detail_level, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, NULL, 'private', 'aggregate', ?, ?)`,
      )
      .bind(
        id,
        slug,
        input.title,
        input.description ?? null,
        input.voteType,
        input.scopeType,
        scopeId,
        admin.id,
        input.eligibleCategories ? stringifyJson(input.eligibleCategories) : null,
        input.thresholdType,
        opensAt,
        input.closesAt,
        status,
        now,
        now,
      ),
    ...candidates.map((c, i) =>
      db
        .prepare(
          `INSERT INTO vote_candidates (id, vote_id, user_id, candidate_name, candidate_bio, nominated_by_user_id, sort_order, eliminated_round, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .bind(uuid(), id, c.userId ?? null, c.name, c.bio ?? null, admin.id, i, now),
    ),
  ];
  await db.batch(statements);

  return toVoteSummary(await getVoteRowOrThrow(db, id));
}

export interface UpdateVoteInput {
  title?: string;
  description?: string | null;
  opensAt?: string;
  closesAt?: string;
}

export async function updateVoteSettings(
  db: DatabaseLike,
  voteId: string,
  input: UpdateVoteInput,
): Promise<VoteSummary> {
  const existing = await getVoteRowOrThrow(db, voteId);
  if (existing.status === "closed") {
    throw new AppError(409, "VOTE_CLOSED", "Cannot update a closed vote");
  }
  const now = nowIso();
  await run(
    db,
    `UPDATE votes SET title = COALESCE(?, title), description = COALESCE(?, description),
       opens_at = COALESCE(?, opens_at), closes_at = COALESCE(?, closes_at), updated_at = ? WHERE id = ?`,
    [input.title ?? null, input.description ?? null, input.opensAt ?? null, input.closesAt ?? null, now, existing.id],
  );
  return toVoteSummary(await getVoteRowOrThrow(db, existing.id));
}

export async function updateVoteVisibility(
  db: DatabaseLike,
  voteId: string,
  input: { visibility?: VoteVisibility; publicDetailLevel?: PublicDetailLevel },
): Promise<VoteSummary> {
  const existing = await getVoteRowOrThrow(db, voteId);
  const now = nowIso();
  await run(
    db,
    `UPDATE votes SET visibility = COALESCE(?, visibility), public_detail_level = COALESCE(?, public_detail_level), updated_at = ? WHERE id = ?`,
    [input.visibility ?? null, input.publicDetailLevel ?? null, now, existing.id],
  );
  return toVoteSummary(await getVoteRowOrThrow(db, existing.id));
}

// ── Admin: list all votes ─────────────────────────────────────────────
//
// Not in endpoint table (which only lists POST/PATCH by id for the
// admin votes surface) — added because the admin UI has nothing else to
// list votes from; staff aren't necessarily also portal members, so the
// member-only GET /api/v1/portal/votes can't stand in. Same "necessary
// addition beyond the literal table" precedent as extra
// sponsorship columns (see migration 0034's header).

export interface AdminVoteSummary extends VoteSummary {
  candidates: CandidateSummary[] | null;
}

const ADMIN_VOTES_SORT_COLUMNS = ["title", "vote_type", "status", "opens_at", "closes_at", "created_at"] as const;
const ADMIN_VOTES_COLUMNS =
  "id, slug, title, description, vote_type, scope_type, scope_id, created_by_user_id, proposed_by_user_id, " +
  "eligible_categories, threshold_type, opens_at, closes_at, current_round, status, result_json, visibility, " +
  "public_detail_level, created_at, updated_at";

export async function listVotesForAdmin(
  db: DatabaseLike,
  params: { status?: VoteStatus; limit: number; offset: number; sort?: string },
): Promise<{ votes: AdminVoteSummary[]; total: number }> {
  const where = params.status ? "WHERE status = ?" : "";
  const whereArgs = params.status ? [params.status] : [];
  const orderBy = resolveOrderBy(params.sort, ADMIN_VOTES_SORT_COLUMNS, "ORDER BY created_at DESC");

  const { rows, total } = await queryPage<VoteRow>(
    db,
    {
      sql: `SELECT ${ADMIN_VOTES_COLUMNS} FROM votes ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...whereArgs, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM votes ${where}`, bindings: whereArgs },
  );

  const electionVoteIds = rows.filter((row) => row.vote_type === "election").map((row) => row.id);
  const candidatesByVoteId = await getCandidatesForVotes(db, electionVoteIds);

  const votes = rows.map((row) => ({
    ...toVoteSummary(row),
    candidates: row.vote_type === "election" ? (candidatesByVoteId.get(row.id) ?? []) : null,
  }));

  return { votes, total };
}

// ── Admin: raw ballot audit ("Full ballot breakdown (staff only)") ────

export interface AdminBallotRow {
  id: string;
  userId: string;
  organizationId: string | null;
  choice: string;
  round: number;
  submittedAt: string;
}

export async function listBallotsForAdmin(db: DatabaseLike, voteId: string): Promise<AdminBallotRow[]> {
  await getVoteRowOrThrow(db, voteId);
  const rows = await all<{
    id: string;
    user_id: string;
    organization_id: string | null;
    choice: string;
    round: number;
    submitted_at: string;
  }>(
    db,
    `SELECT id, user_id, organization_id, choice, round, submitted_at FROM vote_ballots WHERE vote_id = ? ORDER BY round ASC, submitted_at ASC`,
    [voteId],
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    organizationId: r.organization_id,
    choice: r.choice,
    round: r.round,
    submittedAt: r.submitted_at,
  }));
}
