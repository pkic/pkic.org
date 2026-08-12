/**
 * Vote closing & tallying — the scheduled job (membership-scheduled-jobs.ts
 * calls closeDueVotes). Split out of votes.ts (PR #1 review).
 *
 * **Successive-elimination rounds.** describes a live, multi-round
 * process ("after each round, the candidate with fewest votes is
 * eliminated... continues until one candidate holds >50%"), nothing is
 * specified for how a new round's voting window is scheduled. This
 * implementation automates it: closeDueVotes computes the closing round's
 * tally, and if no candidate has a majority, eliminates the lowest-scoring
 * candidate(s) (both, if tied for last — tie rule), increments
 * current_round, and reopens voting for the same duration as the original
 * round (closes_at - opens_at). Voters must recast for the new round;
 * vote_ballots.round scopes each round's ballots independently. The one
 * case doesn't cover: if literally every remaining candidate is tied
 * (eliminating "the fewest" would eliminate everyone), nobody is eliminated
 * and the same round re-runs unchanged — a deliberate reading beyond the
 * letter of the tie rule, needed to avoid a zero-candidate result.
 */
import { all, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { parseJsonSafe, stringifyJson } from "../../utils/json";
import { getVoteRowOrThrow, type VoteRow, type CandidateRow } from "./shared";
import { computeMotionResult, tallyElectionRound, type ElectionRoundTally } from "./tally";
import type { DatabaseLike } from "../../types";

export interface CloseDueVotesResult {
  /** scheduled -> open transitions (initial open, not a round advance). */
  opened: string[];
  closed: string[];
  /** Election votes that advanced to a new round without a winner yet. */
  roundsAdvanced: string[];
}

async function finalizeMotionOrConsultation(db: DatabaseLike, vote: VoteRow): Promise<void> {
  const ballots = await all<{ choice: string }>(db, `SELECT choice FROM vote_ballots WHERE vote_id = ? AND round = ?`, [
    vote.id,
    vote.current_round,
  ]);
  const result = computeMotionResult(vote.threshold_type as "simple_majority" | "supermajority", ballots);
  await run(db, `UPDATE votes SET status = 'closed', result_json = ?, updated_at = ? WHERE id = ?`, [
    stringifyJson(result),
    nowIso(),
    vote.id,
  ]);
}

async function advanceOrFinalizeElection(db: DatabaseLike, vote: VoteRow): Promise<void> {
  const standing = await all<CandidateRow>(
    db,
    `SELECT * FROM vote_candidates WHERE vote_id = ? AND eliminated_round IS NULL ORDER BY sort_order ASC`,
    [vote.id],
  );
  const ballots = await all<{ choice: string }>(db, `SELECT choice FROM vote_ballots WHERE vote_id = ? AND round = ?`, [
    vote.id,
    vote.current_round,
  ]);
  const tally = tallyElectionRound(
    vote.current_round,
    standing.map((c) => c.id),
    ballots,
  );

  const priorRounds = parseJsonSafe<{ rounds: ElectionRoundTally[] }>(vote.result_json, { rounds: [] }).rounds;
  const rounds = [...priorRounds, tally];
  const now = nowIso();

  if (tally.winnerCandidateId || standing.length <= 1) {
    const winnerId = tally.winnerCandidateId ?? standing[0]?.id ?? null;
    await run(db, `UPDATE votes SET status = 'closed', result_json = ?, updated_at = ? WHERE id = ?`, [
      stringifyJson({ rounds, winnerCandidateId: winnerId }),
      now,
      vote.id,
    ]);
    return;
  }

  if (tally.eliminatedCandidateIds.length > 0) {
    for (const candidateId of tally.eliminatedCandidateIds) {
      await run(db, `UPDATE vote_candidates SET eliminated_round = ? WHERE id = ?`, [vote.current_round, candidateId]);
    }
  }
  // If nobody could be eliminated (full tie among all standing candidates),
  // the round re-runs unchanged — see this file's header.

  const durationMs = new Date(vote.closes_at).getTime() - new Date(vote.opens_at).getTime();
  const nextClosesAt = new Date(Date.now() + Math.max(durationMs, 60 * 60 * 1000)).toISOString();
  await run(
    db,
    `UPDATE votes SET current_round = current_round + 1, opens_at = ?, closes_at = ?, result_json = ?, updated_at = ? WHERE id = ?`,
    [now, nextClosesAt, stringifyJson({ rounds }), now, vote.id],
  );
}

/**
 * Opens scheduled votes whose opens_at has passed, then closes/advances
 * open votes whose closes_at has passed. Returns which votes newly opened,
 * closed, or advanced a round, so the caller (membership-scheduled-jobs.ts)
 * can resolve each forum vote's eligible delegates and queue
 * `forum-vote-delegate-notify` — this function never calls queueEmail
 * itself, matching every other service in this codebase.
 */
export async function closeDueVotes(db: DatabaseLike, limit = 50): Promise<CloseDueVotesResult> {
  const now = nowIso();

  const toOpen = await all<{ id: string }>(
    db,
    `SELECT id FROM votes WHERE status = 'scheduled' AND opens_at <= ? LIMIT ?`,
    [now, limit],
  );
  for (const row of toOpen) {
    await run(db, `UPDATE votes SET status = 'open', updated_at = ? WHERE id = ?`, [now, row.id]);
  }

  const toClose = await all<VoteRow>(db, `SELECT * FROM votes WHERE status = 'open' AND closes_at <= ? LIMIT ?`, [
    now,
    limit,
  ]);

  const closed: string[] = [];
  const roundsAdvanced: string[] = [];

  for (const vote of toClose) {
    if (vote.vote_type === "election") {
      const beforeRound = vote.current_round;
      await advanceOrFinalizeElection(db, vote);
      const after = await getVoteRowOrThrow(db, vote.id);
      if (after.status === "closed") closed.push(vote.id);
      else if (after.current_round !== beforeRound) roundsAdvanced.push(vote.id);
    } else {
      await finalizeMotionOrConsultation(db, vote);
      closed.push(vote.id);
    }
  }

  return { opened: toOpen.map((r) => r.id), closed, roundsAdvanced };
}
