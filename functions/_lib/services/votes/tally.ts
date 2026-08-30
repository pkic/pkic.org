/**
 * Pure vote-tallying logic (threshold types) — no DB access, easy to
 * unit-test in isolation. Split out of votes.ts.
 */
import type { BallotChoice } from "./shared";

/**
 * A turnout floor, when the vote opted into one. `eligible` is the size of
 * the electorate that could have cast, counted from the same definition the
 * ballot insert uses.
 */
export interface QuorumRequirement {
  percent: number;
  eligible: number;
}

/**
 * The chair's (or, if the chair did not vote, the deputy's) own ballot, used
 * to settle a tie by counting twice. Only a decisive choice can break a tie:
 * an abstaining chair has declined to settle it.
 */
export interface CastingVote {
  choice: BallotChoice;
  role: "lead" | "deputy_lead";
}

export interface MotionResult {
  thresholdType: "simple_majority" | "supermajority";
  counts: Record<BallotChoice, number>;
  totalBallots: number;
  /** Null when the vote set no turnout floor, which is the bylaw default. */
  quorum: { percent: number; eligible: number; required: number; met: boolean } | null;
  /** Records that a tie was settled by the chair's ballot counting twice. */
  castingVote: { role: "lead" | "deputy_lead"; choice: BallotChoice } | null;
  /**
   * `not_quorate` is deliberately distinct from `failed`: too few Members
   * voted for the question to be settled, which is not the same as the
   * question being rejected, and the two lead to different next steps.
   */
  outcome: "passed" | "failed" | "not_quorate";
}

export function computeMotionResult(
  thresholdType: "simple_majority" | "supermajority",
  ballots: { choice: string }[],
  quorum: QuorumRequirement | null = null,
  castingVote: CastingVote | null = null,
): MotionResult {
  const counts: Record<BallotChoice, number> = { in_favor: 0, opposed: 0, abstain: 0 };
  for (const b of ballots) {
    if (b.choice in counts) counts[b.choice as BallotChoice] += 1;
  }
  return computeMotionResultFromCounts(thresholdType, counts, quorum, castingVote);
}

export function computeMotionResultFromCounts(
  thresholdType: "simple_majority" | "supermajority",
  counts: Record<BallotChoice, number>,
  quorum: QuorumRequirement | null = null,
  castingVote: CastingVote | null = null,
): MotionResult {
  const totalBallots = counts.in_favor + counts.opposed + counts.abstain;
  // A tie is settled, when the vote is configured for it, by counting the
  // chair's own ballot twice. Applying it before the threshold test rather
  // than overriding the outcome afterwards keeps one definition of "passed",
  // and makes the deciding vote visible in the counts it was cast into.
  const tied = counts.in_favor === counts.opposed;
  const applicableCasting = tied && castingVote && castingVote.choice !== "abstain" ? castingVote : null;
  const effective = applicableCasting
    ? { ...counts, [applicableCasting.choice]: counts[applicableCasting.choice] + 1 }
    : counts;
  const effectiveDecisive = effective.in_favor + effective.opposed;

  // Integer cross-multiplication avoids floating-point edge cases at exactly
  // 2/3. Simple majority is ">50% of ballots cast" (strict); supermajority is
  // "≥⅔ of ballots cast" (inclusive) — the two thresholds deliberately use
  // different comparison operators, not just different fractions. "Ballots
  // cast" is read as decisive ballots (in_favor + opposed): abstentions
  // affect neither side, the standard parliamentary convention and the only
  // reading consistent with Article 10 deciding by "members who cast a vote".
  const passed =
    effectiveDecisive > 0 &&
    (thresholdType === "supermajority"
      ? effective.in_favor * 3 >= effectiveDecisive * 2
      : effective.in_favor * 2 > effectiveDecisive);
  // Turnout is measured against every ballot cast, abstentions included: a
  // Member who abstains has taken part. Only the decisive count excludes
  // them, and that is a threshold question, not a participation one.
  const quorumState = quorum
    ? {
        percent: quorum.percent,
        eligible: quorum.eligible,
        // Ceiling, so "50% of 5" requires 3 rather than 2.5 rounded down.
        required: Math.ceil((quorum.eligible * quorum.percent) / 100),
        met: false,
      }
    : null;
  if (quorumState) quorumState.met = totalBallots >= quorumState.required;

  const outcome: MotionResult["outcome"] =
    quorumState && !quorumState.met ? "not_quorate" : passed ? "passed" : "failed";
  return {
    thresholdType,
    counts,
    totalBallots,
    quorum: quorumState,
    castingVote: applicableCasting ? { role: applicableCasting.role, choice: applicableCasting.choice } : null,
    outcome,
  };
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
