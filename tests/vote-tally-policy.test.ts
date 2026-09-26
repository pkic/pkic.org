import { describe, expect, it } from "vitest";
import { computeMotionResultFromCounts } from "../functions/_lib/services/votes/tally";

/**
 * The tally is where the bylaws become code, so these cases are written
 * against the bylaws rather than against the implementation.
 *
 * Article 10 decides a matter "by majority vote of the members ... who cast a
 * vote", and "In the case of a tie vote, the matter will not be approved".
 * Articles 8 and 9 give the Chair the deciding vote on a tied Board or
 * Executive Council vote. Two-thirds appears in Articles 3 and 12.
 */
const counts = (in_favor: number, opposed: number, abstain = 0) => ({ in_favor, opposed, abstain });

describe("motion tally against the bylaws", () => {
  it("does not approve a tie", () => {
    expect(computeMotionResultFromCounts("simple_majority", counts(3, 3)).outcome).toBe("failed");
  });

  it("ignores abstentions when measuring the majority", () => {
    // 2 in favor, 1 opposed, 5 abstaining is a majority of those deciding.
    expect(computeMotionResultFromCounts("simple_majority", counts(2, 1, 5)).outcome).toBe("passed");
  });

  it("treats exactly two thirds as meeting a supermajority", () => {
    expect(computeMotionResultFromCounts("supermajority", counts(2, 1)).outcome).toBe("passed");
    expect(computeMotionResultFromCounts("supermajority", counts(3, 2)).outcome).toBe("failed");
  });

  describe("turnout floor", () => {
    it("is absent by default, so a single decisive ballot settles the matter", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(1, 0));
      expect(result.quorum).toBeNull();
      expect(result.outcome).toBe("passed");
    });

    it("reports not_quorate rather than failed when too few Members took part", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(1, 0), { percent: 50, eligible: 10 });
      // The question was not settled; it was not rejected. The distinction
      // decides whether the vote is worth re-running.
      expect(result.outcome).toBe("not_quorate");
      expect(result.quorum).toEqual({ percent: 50, eligible: 10, required: 5, met: false });
    });

    it("counts abstentions towards turnout, because abstaining is taking part", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(2, 1, 2), { percent: 50, eligible: 10 });
      expect(result.quorum?.met).toBe(true);
      expect(result.outcome).toBe("passed");
    });

    it("rounds the requirement up, so half of five Members means three", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(2, 0), { percent: 50, eligible: 5 });
      expect(result.quorum?.required).toBe(3);
      expect(result.outcome).toBe("not_quorate");
    });
  });

  describe("the chair's deciding vote", () => {
    it("settles a tie by counting the chair's own ballot twice", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(3, 3), null, {
        choice: "in_favor",
        role: "lead",
      });
      expect(result.outcome).toBe("passed");
      expect(result.castingVote).toEqual({ role: "lead", choice: "in_favor" });
    });

    it("can settle a tie against the motion just as readily", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(3, 3), null, {
        choice: "opposed",
        role: "lead",
      });
      expect(result.outcome).toBe("failed");
    });

    it("does not apply when there is no tie to break", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(4, 2), null, {
        choice: "opposed",
        role: "lead",
      });
      expect(result.outcome).toBe("passed");
      expect(result.castingVote, "a deciding vote must not alter a decided result").toBeNull();
    });

    it("does not let an abstaining chair settle anything", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(3, 3), null, {
        choice: "abstain",
        role: "lead",
      });
      expect(result.outcome).toBe("failed");
      expect(result.castingVote).toBeNull();
    });

    it("leaves the reported counts untouched, recording the deciding vote separately", () => {
      const result = computeMotionResultFromCounts("simple_majority", counts(3, 3), null, {
        choice: "in_favor",
        role: "deputy_lead",
      });
      // The roster of who voted how must still reconcile with the ballots.
      expect(result.counts).toEqual(counts(3, 3));
      expect(result.totalBallots).toBe(6);
      expect(result.castingVote?.role).toBe("deputy_lead");
    });

    it("cannot rescue a vote that failed its turnout floor", () => {
      const result = computeMotionResultFromCounts(
        "simple_majority",
        counts(1, 1),
        { percent: 50, eligible: 10 },
        {
          choice: "in_favor",
          role: "lead",
        },
      );
      expect(result.outcome).toBe("not_quorate");
    });
  });
});
