/**
 * Phase 3 §3.2: votes.ts's `result` field was `z.unknown().nullable()`.
 * These assert the replacement `voteResultSchema`/`voteFullResultSchema`
 * actually accept the two real shapes written by
 * functions/_lib/services/votes/tally.ts (motions/consultations) and
 * votes/closing.ts (elections), the outcome-only redaction
 * votes/public.ts's publicResultForDetailLevel produces, and reject
 * garbage.
 */
import { describe, expect, it } from "vitest";
import {
  voteResultSchema,
  voteFullResultSchema,
  motionVoteResultSchema,
  electionVoteResultSchema,
  voteStatusSchema,
  voteProposalStatusSchema,
} from "../assets/shared/schemas/votes";

const MOTION_RESULT = {
  thresholdType: "supermajority",
  counts: { in_favor: 12, opposed: 3, abstain: 1 },
  totalBallots: 16,
  outcome: "passed",
};

const ELECTION_RESULT = {
  rounds: [
    { round: 1, counts: { "cand-a": 4, "cand-b": 2 }, eliminatedCandidateIds: ["cand-b"], winnerCandidateId: null },
    { round: 2, counts: { "cand-a": 6 }, eliminatedCandidateIds: [], winnerCandidateId: "cand-a" },
  ],
  winnerCandidateId: "cand-a",
};

describe("voteFullResultSchema", () => {
  it("accepts a real motion/consultation result (computeMotionResult's exact shape)", () => {
    expect(voteFullResultSchema.safeParse(MOTION_RESULT).success).toBe(true);
    expect(motionVoteResultSchema.safeParse(MOTION_RESULT).success).toBe(true);
  });

  it("accepts a real election result (closing.ts's { rounds, winnerCandidateId } shape)", () => {
    expect(voteFullResultSchema.safeParse(ELECTION_RESULT).success).toBe(true);
    expect(electionVoteResultSchema.safeParse(ELECTION_RESULT).success).toBe(true);
  });

  it("accepts an in-progress election result with no winner yet (mid-round advance)", () => {
    const midRound = { rounds: [ELECTION_RESULT.rounds[0]] };
    expect(voteFullResultSchema.safeParse(midRound).success).toBe(true);
  });

  it("rejects a garbage payload that matches neither shape", () => {
    expect(voteFullResultSchema.safeParse({ notARealField: true }).success).toBe(false);
    expect(voteFullResultSchema.safeParse("just a string").success).toBe(false);
  });

  it("rejects a motion result with a non-integer ballot count", () => {
    expect(
      voteFullResultSchema.safeParse({ ...MOTION_RESULT, counts: { ...MOTION_RESULT.counts, in_favor: 1.5 } }).success,
    ).toBe(false);
  });
});

describe("voteResultSchema (public/portal endpoints)", () => {
  it("accepts null (vote not yet closed)", () => {
    expect(voteResultSchema.safeParse(null).success).toBe(true);
  });

  it("accepts the outcome-only redaction publicResultForDetailLevel produces", () => {
    expect(voteResultSchema.safeParse({ outcome: "passed" }).success).toBe(true);
    expect(voteResultSchema.safeParse({ outcome: "decided" }).success).toBe(true);
    expect(voteResultSchema.safeParse({ outcome: null }).success).toBe(true);
  });

  it("accepts the full motion and election shapes too", () => {
    expect(voteResultSchema.safeParse(MOTION_RESULT).success).toBe(true);
    expect(voteResultSchema.safeParse(ELECTION_RESULT).success).toBe(true);
  });
});

describe("voteStatusSchema / voteProposalStatusSchema", () => {
  it("are closed enums, not bare strings", () => {
    expect(voteStatusSchema.safeParse("open").success).toBe(true);
    expect(voteStatusSchema.safeParse("not_a_real_status").success).toBe(false);
    expect(voteProposalStatusSchema.safeParse("endorsed").success).toBe(true);
    expect(voteProposalStatusSchema.safeParse("not_a_real_status").success).toBe(false);
  });
});
