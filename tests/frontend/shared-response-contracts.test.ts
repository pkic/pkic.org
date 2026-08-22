import { describe, expect, it } from "vitest";
import {
  memberApplicationCreateResponseSchema,
  memberApplicationFormResponseSchema,
  memberApplicationStatusResponseSchema,
} from "../../assets/shared/schemas/member-applications";
import { sponsorshipCheckoutResponseSchema } from "../../assets/shared/schemas/sponsorship";
import { publicVoteGetResponseSchema, publicVotesListResponseSchema } from "../../assets/shared/schemas/votes";

const publicVote = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "example-vote",
  title: "Example vote",
  description: null,
  voteType: "motion",
  scopeType: "forum",
  scopeId: null,
  thresholdType: "simple_majority",
  eligibleCategories: null,
  opensAt: "2026-01-01T00:00:00Z",
  closesAt: "2026-01-02T00:00:00Z",
  currentRound: 0,
  status: "open",
  visibility: "public",
  publicDetailLevel: "aggregate",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  candidates: null,
  result: null,
};

describe("shared frontend response contracts", () => {
  it("accepts valid public vote list and detail envelopes", () => {
    const list = publicVotesListResponseSchema.parse({
      votes: [publicVote],
      page: { limit: 20, offset: 0, total: 1, hasMore: false },
    });
    const detail = publicVoteGetResponseSchema.parse({ vote: publicVote });

    expect(list.votes[0]?.slug).toBe("example-vote");
    expect(detail.vote.id).toBe(publicVote.id);
  });

  it("rejects malformed responses instead of passing them to renderers", () => {
    expect(() => publicVotesListResponseSchema.parse({ votes: [{}], page: {} })).toThrow();
    expect(() => publicVoteGetResponseSchema.parse({ vote: { ...publicVote, status: "unknown" } })).toThrow();
    expect(() => sponsorshipCheckoutResponseSchema.parse({ url: "javascript:alert(1)" })).toThrow();
  });

  it("reuses application response contracts for empty and populated responses", () => {
    expect(memberApplicationFormResponseSchema.parse({ form: null }).form).toBeNull();
    expect(
      memberApplicationCreateResponseSchema.parse({
        applicationId: "00000000-0000-4000-8000-000000000002",
        stage: "pending",
        manageToken: "a-token-with-enough-entropy",
      }).stage,
    ).toBe("pending");
    expect(
      memberApplicationStatusResponseSchema.parse({
        id: "00000000-0000-4000-8000-000000000002",
        stage: "in_review",
        stageEnteredAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
      }).stage,
    ).toBe("in_review");
    expect(() => memberApplicationStatusResponseSchema.parse({ id: "bad", stage: "unknown" })).toThrow();
  });
});
