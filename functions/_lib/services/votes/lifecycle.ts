/**
 * Direct vote creation (staff admin or WG chair), settings/
 * visibility updates, and the admin list/ballot-audit queries. Split out of
 * votes.ts.
 */
import { buildOffsetPageStatements, decodeOffsetPageResults, queryPage } from "../../db/pagination";
import { buildPageInfo, type PageInfo } from "../../../../assets/shared/schemas/pagination";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { stringifyJson } from "../../utils/json";
import { AppError } from "../../errors";
import { resolveMappedOrderBy, resolveOrderBy } from "../../db/sort";
import { buildD1TextSearchFilter } from "../../db/search";
import {
  ADMIN_VOTE_BALLOT_SORT_COLUMNS,
  ADMIN_VOTES_SORT_COLUMNS,
  type AdminVoteBallotsListQuery,
  type AdminVotesListQuery,
} from "../../../../assets/shared/schemas/votes-admin";
import { isAuditOneChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { prepareEffectiveGroupPermissionAuthorizationGuard } from "../groups/governance";
import { prepareVoteRepresentativeNotificationIntents } from "./representative-notification-intents";
import {
  resolveVoteOwnerGroup,
  uniqueSlug,
  toVoteSummary,
  getVoteRowOrThrow,
  getCandidatesForVotes,
  VOTE_ROW_COLUMNS,
  type VoteRow,
  type VoteType,
  type VoteElectorateMode,
  type ThresholdType,
  type VoteStatus,
  type VoteVisibility,
  type PublicDetailLevel,
  type VoteSummary,
  type CandidateSummary,
} from "./shared";
import { prepareVoteManagementAuthorizationGuard } from "./vote-access";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { validateVoteConfiguration, validateVoteWindow } from "./configuration";

export interface CreateVoteInput {
  title: string;
  description?: string;
  voteType: VoteType;
  ownerGroupId: string;
  electorateMode: VoteElectorateMode;
  thresholdType: ThresholdType;
  eligibleCategories?: string[] | null;
  opensAt?: string;
  closesAt: string;
  candidates?: { name: string; bio?: string; userId?: string | null }[];
}

export async function createVoteDirect(
  db: DatabaseLike,
  admin: AuthAdmin,
  input: CreateVoteInput,
): Promise<VoteSummary> {
  const ownerGroupId = await resolveVoteOwnerGroup(db, input.ownerGroupId);
  const candidates = input.voteType === "election" ? (input.candidates ?? []) : [];
  const now = nowIso();
  const opensAt = input.opensAt ?? now;
  validateVoteConfiguration({
    voteType: input.voteType,
    thresholdType: input.thresholdType,
    candidateCount: candidates.length,
    opensAt,
    closesAt: input.closesAt,
  });

  const id = uuid();
  const slug = await uniqueSlug(db, input.title);
  const status: VoteStatus = new Date(opensAt).getTime() <= Date.now() ? "open" : "scheduled";
  const databaseUserId = adminDatabaseUserId(admin);

  // Build every statement first, execute once via db.batch() — the vote row
  // and its candidates are one atomic unit of work (PR #1 review §5.3): a
  // constraint failure on any candidate insert must not leave a vote row
  // committed with no candidates (or only some), visible to concurrent
  // reads, or a slug a retry then collides with.
  const statements = [
    prepareEffectiveGroupPermissionAuthorizationGuard(db, admin, [ownerGroupId], "votes:create"),
    db
      .prepare(
        `INSERT INTO votes
           (id, slug, title, description, vote_type, owner_group_id, electorate_mode,
            created_by_user_id, proposed_by_user_id,
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
        ownerGroupId,
        input.electorateMode,
        databaseUserId,
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
        .bind(uuid(), id, c.userId ?? null, c.name, c.bio ?? null, databaseUserId, i, now),
    ),
    prepareAuditLog(
      db,
      "admin",
      admin.id,
      "vote_created",
      "vote",
      id,
      {
        title: input.title,
        voteType: input.voteType,
        ownerGroupId,
        electorateMode: input.electorateMode,
      },
      now,
    ),
    prepareVoteRepresentativeNotificationIntents(db, id, 1, now),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "VOTE_CREATE_AUTHORIZATION_CHANGED", "Vote creation permission changed before commit");
    }
    throw error;
  }

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
  admin: AuthAdmin,
  voteId: string,
  input: UpdateVoteInput,
  throughGroupId?: string,
): Promise<VoteSummary> {
  const existing = await getVoteRowOrThrow(db, voteId);
  if (existing.status === "closed") {
    throw new AppError(409, "VOTE_CLOSED", "Cannot update a closed vote");
  }
  const opensAt = input.opensAt ?? existing.opens_at;
  const closesAt = input.closesAt ?? existing.closes_at;
  validateVoteWindow(opensAt, closesAt);
  const now = nowIso();
  try {
    await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, admin, existing.id, throughGroupId),
      db
        .prepare(
          `UPDATE votes SET
             title = CASE WHEN ? = 1 THEN ? ELSE title END,
             description = CASE WHEN ? = 1 THEN ? ELSE description END,
             opens_at = CASE WHEN ? = 1 THEN ? ELSE opens_at END,
             closes_at = CASE WHEN ? = 1 THEN ? ELSE closes_at END,
             transition_revision = transition_revision + 1,
             updated_at = ?
           WHERE id = ?
             AND transition_revision = ?
             AND transition_processing_token IS NULL`,
        )
        .bind(
          input.title === undefined ? 0 : 1,
          input.title ?? null,
          input.description === undefined ? 0 : 1,
          input.description ?? null,
          input.opensAt === undefined ? 0 : 1,
          input.opensAt ?? null,
          input.closesAt === undefined ? 0 : 1,
          input.closesAt ?? null,
          now,
          existing.id,
          existing.transition_revision,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        admin.id,
        "vote_updated",
        "vote",
        existing.id,
        { changes: input },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "VOTE_MANAGEMENT_CHANGED", "Vote management permission changed before commit");
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "VOTE_CHANGED", "Vote state changed; reload and retry");
    }
    throw error;
  }
  return toVoteSummary(await getVoteRowOrThrow(db, existing.id));
}

export async function updateVoteVisibility(
  db: DatabaseLike,
  admin: AuthAdmin,
  voteId: string,
  input: { visibility?: VoteVisibility; publicDetailLevel?: PublicDetailLevel },
  throughGroupId?: string,
): Promise<VoteSummary> {
  const existing = await getVoteRowOrThrow(db, voteId);
  const now = nowIso();
  try {
    await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, admin, existing.id, throughGroupId),
      db
        .prepare(
          `UPDATE votes
           SET visibility = COALESCE(?, visibility),
               public_detail_level = COALESCE(?, public_detail_level),
               transition_revision = transition_revision + 1,
               updated_at = ?
           WHERE id = ?
             AND transition_revision = ?
             AND transition_processing_token IS NULL`,
        )
        .bind(
          input.visibility ?? null,
          input.publicDetailLevel ?? null,
          now,
          existing.id,
          existing.transition_revision,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        admin.id,
        "vote_visibility_updated",
        "vote",
        existing.id,
        { changes: input },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "VOTE_MANAGEMENT_CHANGED", "Vote management permission changed before commit");
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "VOTE_CHANGED", "Vote state changed; reload and retry");
    }
    throw error;
  }
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

export async function listVotesForAdmin(
  db: DatabaseLike,
  params: AdminVotesListQuery,
): Promise<{ votes: AdminVoteSummary[]; total: number }> {
  const conditions: string[] = [];
  const whereArgs: unknown[] = [];
  if (params.status) {
    conditions.push("status = ?");
    whereArgs.push(params.status);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "title",
      "description",
      "status",
      "vote_type",
      "electorate_mode",
      "(SELECT name FROM groups owner_group WHERE owner_group.id = votes.owner_group_id)",
    ]);
    conditions.push(search.sql);
    whereArgs.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveOrderBy(params.sort, ADMIN_VOTES_SORT_COLUMNS, "ORDER BY created_at DESC", "id ASC");

  const { rows, total } = await queryPage<VoteRow>(db, {
    sql: `SELECT ${VOTE_ROW_COLUMNS} FROM votes ${where}`,
    bindings: whereArgs,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

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
  memberId: string | null;
  choice: string;
  round: number;
  submittedAt: string;
  updatedAt: string;
}

interface AdminBallotDbRow {
  id: string;
  user_id: string;
  member_id: string | null;
  choice: string;
  round: number;
  submitted_at: string;
  updated_at: string;
}

const ADMIN_BALLOT_SORT_COLUMNS = {
  submittedAt: "b.submitted_at",
  round: "b.round",
  choice: "b.choice",
  userId: "b.user_id",
  memberId: "b.member_id",
} as const satisfies Record<(typeof ADMIN_VOTE_BALLOT_SORT_COLUMNS)[number], string>;

export async function listBallotsForManager(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
  query: AdminVoteBallotsListQuery,
  throughGroupId?: string,
): Promise<{ ballots: AdminBallotRow[]; page: PageInfo }> {
  await getVoteRowOrThrow(db, voteId);
  const conditions = ["b.vote_id = ?"];
  const bindings: unknown[] = [voteId];
  if (query.round !== undefined) {
    conditions.push("b.round = ?");
    bindings.push(query.round);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["b.user_id", "b.member_id", "b.choice", "b.round"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    ADMIN_BALLOT_SORT_COLUMNS,
    "b.round ASC, b.submitted_at ASC",
    "b.id ASC",
  );
  const pageQuery = {
    sql: `SELECT b.id, b.user_id, b.member_id, b.choice, b.round, b.submitted_at, b.updated_at
              FROM vote_ballots b ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  };
  let rows: AdminBallotDbRow[];
  let total: number;
  try {
    const [guardResult, pageResult, countResult] = await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, actor, voteId, throughGroupId),
      ...buildOffsetPageStatements(db, pageQuery),
    ]);
    void guardResult;
    ({ rows, total } = decodeOffsetPageResults<AdminBallotDbRow>(pageResult, countResult));
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "VOTE_MANAGEMENT_CHANGED", "Vote management permission changed before the ballot read");
    }
    throw error;
  }
  const ballots = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    memberId: r.member_id,
    choice: r.choice,
    round: r.round,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
  }));
  return { ballots, page: buildPageInfo(query.limit, query.offset, total, ballots.length) };
}
