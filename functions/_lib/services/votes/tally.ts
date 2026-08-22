/**
 * Pure vote-tallying logic (threshold types) — no DB access, easy to
 * unit-test in isolation. Split out of votes.ts.
 */
import type { BallotChoice } from "./shared";

export interface MotionResult {
  thresholdType: "simple_majority" | "supermajority";
  counts: Record<BallotChoice, number>;
  totalBallots: number;
  outcome: "passed" | "failed";
}

export function computeMotionResult(
  thresholdType: "simple_majority" | "supermajority",
  ballots: { choice: string }[],
): MotionResult {
  const counts: Record<BallotChoice, number> = { in_favor: 0, opposed: 0, abstain: 0 };
  for (const b of ballots) {
    if (b.choice in counts) counts[b.choice as BallotChoice] += 1;
  }
  return computeMotionResultFromCounts(thresholdType, counts);
}

export function computeMotionResultFromCounts(
  thresholdType: "simple_majority" | "supermajority",
  counts: Record<BallotChoice, number>,
): MotionResult {
  const totalBallots = counts.in_favor + counts.opposed + counts.abstain;
  const decisive = counts.in_favor + counts.opposed;
  // Integer cross-multiplication avoids floating-point edge cases at
  // exactly 2/3. Simple majority is ">50% of ballots cast" (strict);
  // supermajority is "≥⅔ of ballots cast" (inclusive) — the two thresholds
  // deliberately use different comparison operators, not just different
  // fractions. "Ballots cast" is read as decisive ballots (in_favor +
  // opposed) — abstentions affect neither side, the standard parliamentary
  // convention and the only reading consistent with "no quorum
  // requirement... binding based on members who cast a vote" language.
  const passed =
    decisive > 0 &&
    (thresholdType === "supermajority" ? counts.in_favor * 3 >= decisive * 2 : counts.in_favor * 2 > decisive);
  const outcome: "passed" | "failed" = passed ? "passed" : "failed";
  return { thresholdType, counts, totalBallots, outcome };
}

export interface ElectionRoundTally {
  round: number;
  counts: Record<string, number>;
  eliminatedCandidateIds: string[];
  winnerCandidateId: string | null;
}

/**
 * Tallies one round of an election. Returns the winner (>50% of that
 * round's ballots) or the candidate id(s) to eliminate for the next round.
 * When every standing candidate is tied, nobody is eliminated (see this
 * file's header) — the caller re-runs the same round.
 */
export function tallyElectionRound(
  round: number,
  standingCandidateIds: string[],
  ballots: { choice: string }[],
): ElectionRoundTally {
  const counts: Record<string, number> = Object.fromEntries(standingCandidateIds.map((id) => [id, 0]));
  for (const b of ballots) {
    if (b.choice in counts) counts[b.choice] += 1;
  }
  return tallyElectionRoundFromCounts(round, standingCandidateIds, counts);
}

export function tallyElectionRoundFromCounts(
  round: number,
  standingCandidateIds: string[],
  counts: Record<string, number>,
): ElectionRoundTally {
  const normalizedCounts: Record<string, number> = Object.fromEntries(
    standingCandidateIds.map((id) => [id, Math.max(0, Math.floor(counts[id] ?? 0))]),
  );
  const total = Object.values(normalizedCounts).reduce((sum, count) => sum + count, 0);

  if (standingCandidateIds.length === 1) {
    return { round, counts: normalizedCounts, eliminatedCandidateIds: [], winnerCandidateId: standingCandidateIds[0] };
  }

  const winner = standingCandidateIds.find((id) => total > 0 && normalizedCounts[id] / total > 0.5) ?? null;
  if (winner) {
    return { round, counts: normalizedCounts, eliminatedCandidateIds: [], winnerCandidateId: winner };
  }

  const lowest = Math.min(...standingCandidateIds.map((id) => normalizedCounts[id]));
  const lowestIds = standingCandidateIds.filter((id) => normalizedCounts[id] === lowest);
  const eliminatedCandidateIds = lowestIds.length === standingCandidateIds.length ? [] : lowestIds;
  return { round, counts: normalizedCounts, eliminatedCandidateIds, winnerCandidateId: null };
}
