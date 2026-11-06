/**
 * Direct vote creation (staff admin or WG chair), settings/
 * visibility updates, and the admin list/ballot-audit queries. Split out of
 * votes.ts.
 */
import { deriveVoteStatus } from "./status";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { stringifyJson } from "../../utils/json";
import { AppError } from "../../errors";
import { isAuditChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { prepareEffectiveGroupPermissionAuthorizationGuard } from "../groups/governance";
import { prepareVoteRepresentativeNotificationIntents } from "./representative-notification-intents";
import {
  resolveVoteOwnerGroup,
  uniqueSlug,
  toVoteSummary,
  getVoteRowOrThrow,
  type VoteType,
  type VoteElectorateMode,
  type ThresholdType,
  type VoteVisibility,
  type PublicDetailLevel,
  type VoteSummary,
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
  questionFormId?: string | null;
  quorumPercent?: number | null;
  tieBreakMode?: "none" | "chair";
  excludedMemberIds?: string[] | null;
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
            eligible_categories, threshold_type, question_form_id, quorum_percent, tie_break_mode, excluded_member_ids,
            opens_at, closes_at, current_round, result_json,
            visibility, public_detail_level, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 'private', 'aggregate', ?, ?)`,
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
        input.questionFormId ?? null,
        input.quorumPercent ?? null,
        input.tieBreakMode ?? "none",
        input.excludedMemberIds && input.excludedMemberIds.length > 0 ? stringifyJson(input.excludedMemberIds) : null,
        opensAt,
        input.closesAt,
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
  if (deriveVoteStatus(existing, nowIso()) === "closed") {
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
    if (isAuditChangeGuardFailure(error)) {
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
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "VOTE_CHANGED", "Vote state changed; reload and retry");
    }
    throw error;
  }
  return toVoteSummary(await getVoteRowOrThrow(db, existing.id));
}
