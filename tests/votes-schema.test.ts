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
  publicVoteGetResponseSchema,
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
    expect(voteResultSchema.parse(MOTION_RESULT)).toEqual(MOTION_RESULT);
    expect(voteResultSchema.parse(ELECTION_RESULT)).toEqual(ELECTION_RESULT);
  });
});

describe("publicVoteGetResponseSchema", () => {
  it("accepts the complete public motion and election projections", () => {
    const shared = {
      description: "Closed vote",
      eligibleCategories: null,
      opensAt: "2026-08-21T12:00:00Z",
      closesAt: "2026-08-22T12:00:00Z",
      currentRound: 1,
      status: "closed" as const,
      visibility: "public" as const,
      publicDetailLevel: "full_breakdown" as const,
      createdAt: "2026-08-20T12:00:00Z",
      updatedAt: "2026-08-22T12:00:00Z",
    };

    expect(
      publicVoteGetResponseSchema.safeParse({
        vote: {
          ...shared,
          id: "00000000-0000-4000-8000-000000000001",
          slug: "closed-motion",
          title: "Closed Motion",
          voteType: "motion",
          scopeType: "forum",
          scopeId: null,
          thresholdType: "simple_majority",
          candidates: null,
          result: MOTION_RESULT,
        },
      }).success,
    ).toBe(true);

    expect(
      publicVoteGetResponseSchema.safeParse({
        vote: {
          ...shared,
          id: "00000000-0000-4000-8000-000000000002",
          slug: "closed-election",
          title: "Closed Election",
          voteType: "election",
          scopeType: "working_group",
          scopeId: "00000000-0000-4000-8000-000000000003",
          thresholdType: "successive_elimination",
          candidates: [
            {
              id: "00000000-0000-4000-8000-000000000004",
              userId: null,
              candidateName: "Alice Candidate",
              candidateBio: null,
              sortOrder: 0,
              eliminatedRound: null,
            },
          ],
          result: {
            rounds: [
              {
                round: 1,
                counts: { "00000000-0000-4000-8000-000000000004": 1 },
                eliminatedCandidateIds: [],
                winnerCandidateId: "00000000-0000-4000-8000-000000000004",
              },
            ],
            winnerCandidateId: "00000000-0000-4000-8000-000000000004",
          },
        },
      }).success,
    ).toBe(true);
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
