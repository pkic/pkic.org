import type { VoteLifecycleTransition } from "../../../../assets/shared/schemas/vote-management";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { createDurableJobLease } from "../../jobs/lease";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { closeClaimedVote, releaseClaimedVote, type ClaimedVote } from "./automatic-transitions";
import { prepareVoteRepresentativeNotificationIntents } from "./representative-notification-intents";
import { getVoteRowOrThrow, toVoteSummary, type VoteRow, type VoteSummary } from "./shared";
import { hasVoteManagementAuthorization, prepareVoteManagementAuthorizationGuard } from "./vote-access";

export type ManagedVoteTransitionOutcome = "opened" | "closed" | "round_advanced" | "cancelled";

export interface ManagedVoteTransitionResult {
  vote: VoteSummary;
  outcome: ManagedVoteTransitionOutcome;
}

function managementChangedError(): AppError {
  return new AppError(409, "VOTE_MANAGEMENT_CHANGED", "Vote management permission changed before commit");
}

function voteChangedError(): AppError {
  return new AppError(409, "VOTE_CHANGED", "Vote lifecycle state changed; reload and retry");
}

async function openManagedVote(
  db: DatabaseLike,
  actor: AuthAdmin,
  vote: VoteRow,
  throughGroupId: string,
): Promise<ManagedVoteTransitionResult> {
  if (vote.status !== "scheduled") {
    throw new AppError(422, "VOTE_CANNOT_OPEN", "Only a scheduled vote can be opened");
  }
  const now = nowIso();
  if (Date.parse(vote.closes_at) <= Date.parse(now)) {
    throw new AppError(422, "VOTE_CANNOT_OPEN", "A vote cannot open after its closing time");
  }
  try {
    await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, actor, vote.id, throughGroupId),
      db
        .prepare(
          `UPDATE votes
           SET status = 'open', opens_at = CASE WHEN opens_at > ? THEN ? ELSE opens_at END,
               transition_revision = transition_revision + 1, updated_at = ?
           WHERE id = ?
             AND status = 'scheduled'
             AND transition_revision = ?
             AND transition_processing_token IS NULL
             AND closes_at > ?`,
        )
        .bind(now, now, now, vote.id, vote.transition_revision, now),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "vote_opened_manually",
        "vote",
        vote.id,
        { previouslyScheduledFor: vote.opens_at },
        now,
      ),
      prepareVoteRepresentativeNotificationIntents(db, vote.id, vote.current_round, now),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) throw managementChangedError();
    if (isAuditOneChangeGuardFailure(error)) throw voteChangedError();
    throw error;
  }
  return { vote: toVoteSummary(await getVoteRowOrThrow(db, vote.id)), outcome: "opened" };
}

async function cancelManagedVote(
  db: DatabaseLike,
  actor: AuthAdmin,
  vote: VoteRow,
  throughGroupId: string,
  reason: string,
): Promise<ManagedVoteTransitionResult> {
  if (vote.status !== "scheduled" && vote.status !== "open") {
    throw new AppError(422, "VOTE_CANNOT_CANCEL", "Only a scheduled or open vote can be cancelled");
  }
  const now = nowIso();
  try {
    await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, actor, vote.id, throughGroupId),
      db
        .prepare(
          `UPDATE votes
           SET status = 'cancelled', cancellation_reason = ?, transition_revision = transition_revision + 1,
               transition_processing_token = NULL, transition_lease_expires_at = NULL, updated_at = ?
           WHERE id = ?
             AND status IN ('scheduled', 'open')
             AND transition_revision = ?
             AND (transition_processing_token IS NULL OR transition_lease_expires_at <= ?)`,
        )
        .bind(reason, now, vote.id, vote.transition_revision, now),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "vote_cancelled",
        "vote",
        vote.id,
        { reason, previousStatus: vote.status },
        now,
      ),
      db
        .prepare("DELETE FROM vote_representative_notification_intents WHERE vote_id = ? AND queued_outbox_id IS NULL")
        .bind(vote.id),
      db
        .prepare(
          `UPDATE email_outbox
           SET status = 'cancelled', last_error = ?, processing_token = NULL,
               lease_expires_at = NULL, updated_at = ?
           WHERE instr(idempotency_key, ?) = 1
             AND status IN ('queued', 'retrying')`,
        )
        .bind(`Vote cancelled: ${reason}`, now, `member-vote-representative-notify:${vote.id}:`),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) throw managementChangedError();
    if (isAuditOneChangeGuardFailure(error)) throw voteChangedError();
    throw error;
  }
  return { vote: toVoteSummary(await getVoteRowOrThrow(db, vote.id)), outcome: "cancelled" };
}

async function claimManagedVoteClose(
  db: DatabaseLike,
  actor: AuthAdmin,
  vote: VoteRow,
  throughGroupId: string,
  now: string,
): Promise<ClaimedVote> {
  const lease = createDurableJobLease(new Date(now));
  try {
    await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, actor, vote.id, throughGroupId),
      db
        .prepare(
          `UPDATE votes
           SET transition_processing_token = ?, transition_lease_expires_at = ?,
               transition_revision = transition_revision + 1, updated_at = ?
           WHERE id = ?
             AND status = 'open'
             AND current_round = ?
             AND transition_revision = ?
             AND closes_at = ?
             AND (transition_processing_token IS NULL OR transition_lease_expires_at <= ?)`,
        )
        .bind(
          lease.token,
          lease.expiresAt,
          now,
          vote.id,
          vote.current_round,
          vote.transition_revision,
          vote.closes_at,
          now,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "vote_close_requested",
        "vote",
        vote.id,
        { round: vote.current_round },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) throw managementChangedError();
    if (isAuditOneChangeGuardFailure(error)) throw voteChangedError();
    throw error;
  }
  return {
    ...vote,
    transition_revision: vote.transition_revision + 1,
    transition_processing_token: lease.token,
    transition_lease_expires_at: lease.expiresAt,
    updated_at: now,
  };
}

async function closeManagedVote(
  db: DatabaseLike,
  actor: AuthAdmin,
  vote: VoteRow,
  throughGroupId: string,
): Promise<ManagedVoteTransitionResult> {
  if (vote.status !== "open") {
    throw new AppError(422, "VOTE_CANNOT_CLOSE", "Only an open vote can be closed");
  }
  const now = nowIso();
  const claimed = await claimManagedVoteClose(db, actor, vote, throughGroupId, now);
  try {
    const outcome = await closeClaimedVote(db, claimed, now, {
      actorType: "admin",
      actorId: actor.id,
      mode: "manually",
      authorizationGuard: await prepareVoteManagementAuthorizationGuard(db, actor, vote.id, throughGroupId),
      finalClosesAt: now,
    });
    if (outcome === "stale") throw voteChangedError();
    return {
      vote: toVoteSummary(await getVoteRowOrThrow(db, vote.id)),
      outcome: outcome === "round-advanced" ? "round_advanced" : "closed",
    };
  } catch (error) {
    await releaseClaimedVote(db, claimed, now);
    if (isAuthorizationGuardFailure(error)) throw managementChangedError();
    throw error;
  }
}

export async function transitionManagedVote(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
  transition: VoteLifecycleTransition,
  throughGroupId: string,
): Promise<ManagedVoteTransitionResult> {
  const vote = await getVoteRowOrThrow(db, voteId);
  if (!(await hasVoteManagementAuthorization(db, actor, vote.id, throughGroupId))) {
    throw new AppError(403, "VOTE_MANAGEMENT_REQUIRED", "The selected group cannot manage this vote");
  }
  switch (transition.transition) {
    case "open":
      return openManagedVote(db, actor, vote, throughGroupId);
    case "close":
      return closeManagedVote(db, actor, vote, throughGroupId);
    case "cancel":
      return cancelManagedVote(db, actor, vote, throughGroupId, transition.reason);
  }
}
