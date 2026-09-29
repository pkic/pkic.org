import { describe, expect, it } from "vitest";
import {
  membershipCategorySelectionSchema,
  MEMBERSHIP_CATEGORIES,
} from "../assets/shared/schemas/membership-categories";
import { groupMailingListCreateSchema } from "../assets/shared/schemas/mailing-lists";
import { voteCreateInputSchema } from "../assets/shared/schemas/vote-management";
import { groupVoteProposalCreateSchema } from "../assets/shared/schemas/group-vote-proposals";

const groupId = "20000000-0000-4000-8000-000000000001";

describe("membership category selection contract", () => {
  it("has one bounded, unique category selection schema", () => {
    expect(membershipCategorySelectionSchema.safeParse(["A", "H1"]).success).toBe(true);
    expect(membershipCategorySelectionSchema.safeParse(["A", "A"]).success).toBe(false);
    expect(membershipCategorySelectionSchema.safeParse([...MEMBERSHIP_CATEGORIES, "A"]).success).toBe(false);
  });

  it("applies that boundary consistently to votes, proposals, and mailing lists", () => {
    const duplicateSelection = ["A", "A"];
    expect(
      voteCreateInputSchema.safeParse({
        title: "Duplicate category vote",
        voteType: "motion",
        ownerGroupId: groupId,
        electorateMode: "per_member",
        thresholdType: "simple_majority",
        closesAt: "2027-01-01T12:00:00.000Z",
        eligibleCategories: duplicateSelection,
      }).success,
    ).toBe(false);
    expect(
      groupVoteProposalCreateSchema.safeParse({
        title: "Duplicate category proposal",
        description: "A sufficiently complete proposal description.",
        voteType: "motion",
        eligibleCategories: duplicateSelection,
      }).success,
    ).toBe(false);
    expect(
      groupMailingListCreateSchema.safeParse({
        email: "discussion@example.test",
        label: "Discussion",
        purpose: "group",
        autoSyncCategories: duplicateSelection,
      }).success,
    ).toBe(false);
  });
});
