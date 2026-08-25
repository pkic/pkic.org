import { all, first } from "../../db/queries";
import { createDurableJobLease } from "../../jobs/lease";
import type { DatabaseLike, StatementLike } from "../../types";
import { parseJsonSafe, stringifyJson } from "../../utils/json";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { VOTE_ELECTION_TALLY_QUERY, VOTE_MOTION_TALLY_QUERY, VOTE_STANDING_CANDIDATES_QUERY } from "./due-queries";
import type { CandidateRow, VoteRow } from "./shared";
import { computeMotionResultFromCounts, tallyElectionRoundFromCounts, type ElectionRoundTally } from "./tally";
import { prepareVoteRepresentativeNotificationIntents } from "./representative-notification-intents";

interface MotionCountsRow {
  in_favor: number;
  opposed: number;
  abstain: number;
}

interface ElectionCountRow {
  choice: string;
  ballot_count: number;
}

export type ClaimedVote = VoteRow & {
  transition_processing_token: string;
  transition_lease_expires_at: string;
};

export type CloseOutcome = "closed" | "round-advanced" | "stale";

const MAX_ELECTION_CANDIDATES = 50;

export async function openDueVote(db: DatabaseLike, vote: VoteRow, now: string): Promise<boolean> {
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE votes
           SET status = 'open', transition_revision = transition_revision + 1, updated_at = ?
           WHERE id = ?
             AND status = 'scheduled'
             AND transition_revision = ?
             AND transition_processing_token IS NULL
             AND opens_at = ?
             AND opens_at <= ?`,
        )
        .bind(now, vote.id, vote.transition_revision, vote.opens_at, now),
      prepareAuditLogAfterOneChange(
        db,
        "system",
        null,
        "vote_opened_automatically",
        "vote",
        vote.id,
        { opensAt: vote.opens_at, transitionRevision: vote.transition_revision },
        now,
      ),
      prepareVoteRepresentativeNotificationIntents(db, vote.id, vote.current_round, now),
    ]);
    return true;
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) return false;
    throw error;
  }
}

export async function claimDueVote(db: DatabaseLike, vote: VoteRow, now: string): Promise<ClaimedVote | null> {
  const lease = createDurableJobLease(new Date(now));
  const claim = await db
    .prepare(
      `UPDATE votes
       SET transition_processing_token = ?, transition_lease_expires_at = ?,
           transition_revision = transition_revision + 1, updated_at = ?
       WHERE id = ?
         AND status = 'open'
         AND current_round = ?
         AND transition_revision = ?
         AND closes_at = ?
         AND closes_at <= ?
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
      now,
    )
    .run();
  if (claim.meta?.changes !== 1) return null;
  return {
    ...vote,
    transition_revision: vote.transition_revision + 1,
    transition_processing_token: lease.token,
    transition_lease_expires_at: lease.expiresAt,
    updated_at: now,
  };
}

function prepareFinalizeVoteStatement(
  db: DatabaseLike,
  vote: ClaimedVote,
  resultJson: string,
  now: string,
): StatementLike {
  return db
    .prepare(
      `UPDATE votes
       SET status = 'closed', result_json = ?,
           transition_revision = transition_revision + 1,
           transition_processing_token = NULL, transition_lease_expires_at = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'open'
         AND current_round = ?
         AND transition_revision = ?
         AND transition_processing_token = ?
         AND closes_at = ?`,
    )
    .bind(
      resultJson,
      now,
      vote.id,
      vote.current_round,
      vote.transition_revision,
      vote.transition_processing_token,
      vote.closes_at,
    );
}

async function finalizeMotionOrConsultation(db: DatabaseLike, vote: ClaimedVote, now: string): Promise<CloseOutcome> {
  const counts = await first<MotionCountsRow>(db, VOTE_MOTION_TALLY_QUERY, [vote.id, vote.current_round]);
  const result = computeMotionResultFromCounts(vote.threshold_type as "simple_majority" | "supermajority", {
    in_favor: Number(counts?.in_favor ?? 0),
    opposed: Number(counts?.opposed ?? 0),
    abstain: Number(counts?.abstain ?? 0),
  });

  try {
    await db.batch([
      prepareFinalizeVoteStatement(db, vote, stringifyJson(result), now),
      prepareAuditLogAfterOneChange(
        db,
        "system",
        null,
        "vote_closed_automatically",
        "vote",
        vote.id,
        { round: vote.current_round, result },
        now,
      ),
    ]);
    return "closed";
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) return "stale";
    throw error;
  }
}

async function advanceOrFinalizeElection(db: DatabaseLike, vote: ClaimedVote, now: string): Promise<CloseOutcome> {
  const standing = await all<CandidateRow>(db, VOTE_STANDING_CANDIDATES_QUERY, [vote.id, MAX_ELECTION_CANDIDATES + 1]);
  if (standing.length > MAX_ELECTION_CANDIDATES) {
    throw new Error(`Vote ${vote.id} exceeds the maximum of ${MAX_ELECTION_CANDIDATES} standing candidates`);
  }
  const ballotCounts = await all<ElectionCountRow>(db, VOTE_ELECTION_TALLY_QUERY, [vote.id, vote.current_round]);
  const counts = Object.fromEntries(ballotCounts.map((row) => [row.choice, Number(row.ballot_count)]));
  const tally = tallyElectionRoundFromCounts(
    vote.current_round,
    standing.map((candidate) => candidate.id),
    counts,
  );
  const priorRounds = parseJsonSafe<{ rounds: ElectionRoundTally[] }>(vote.result_json, { rounds: [] }).rounds;
  const rounds = [...priorRounds, tally];

  if (tally.winnerCandidateId || standing.length <= 1) {
    const winnerCandidateId = tally.winnerCandidateId ?? standing[0]?.id ?? null;
    const result = { rounds, winnerCandidateId };
    try {
      await db.batch([
        prepareFinalizeVoteStatement(db, vote, stringifyJson(result), now),
        prepareAuditLogAfterOneChange(
          db,
          "system",
          null,
          "vote_closed_automatically",
          "vote",
          vote.id,
          { round: vote.current_round, winnerCandidateId },
          now,
        ),
      ]);
      return "closed";
    } catch (error) {
      if (isAuditOneChangeGuardFailure(error)) return "stale";
      throw error;
    }
  }

  const durationMs = new Date(vote.closes_at).getTime() - new Date(vote.opens_at).getTime();
  const nextClosesAt = new Date(new Date(now).getTime() + Math.max(durationMs, 60 * 60 * 1_000)).toISOString();
  const statements: StatementLike[] = [];
  if (tally.eliminatedCandidateIds.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE vote_candidates
           SET eliminated_round = ?
           WHERE vote_id = ?
             AND eliminated_round IS NULL
             AND id IN (SELECT value FROM json_each(?))`,
        )
        .bind(vote.current_round, vote.id, stringifyJson(tally.eliminatedCandidateIds)),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE votes
         SET current_round = current_round + 1,
             opens_at = ?, closes_at = ?, result_json = ?,
             transition_revision = transition_revision + 1,
             transition_processing_token = NULL, transition_lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ?
           AND status = 'open'
           AND current_round = ?
           AND transition_revision = ?
           AND transition_processing_token = ?
           AND closes_at = ?`,
      )
      .bind(
        now,
        nextClosesAt,
        stringifyJson({ rounds }),
        now,
        vote.id,
        vote.current_round,
        vote.transition_revision,
        vote.transition_processing_token,
        vote.closes_at,
      ),
    prepareAuditLogAfterOneChange(
      db,
      "system",
      null,
      "vote_round_advanced_automatically",
      "vote",
      vote.id,
      {
        fromRound: vote.current_round,
        toRound: vote.current_round + 1,
        eliminatedCandidateIds: tally.eliminatedCandidateIds,
        nextClosesAt,
      },
      now,
    ),
    prepareVoteRepresentativeNotificationIntents(db, vote.id, vote.current_round + 1, now),
  );

  try {
    await db.batch(statements);
    return "round-advanced";
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) return "stale";
    throw error;
  }
}

export function closeClaimedVote(db: DatabaseLike, vote: ClaimedVote, now: string): Promise<CloseOutcome> {
  return vote.vote_type === "election"
    ? advanceOrFinalizeElection(db, vote, now)
    : finalizeMotionOrConsultation(db, vote, now);
}
