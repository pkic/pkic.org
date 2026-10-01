import { describe, expect, it } from "vitest";
import {
  proposalPermissionAlternativesForRequest,
  proposalPermissionForRequest,
} from "../functions/_lib/auth/proposal-route-policy";

import {
  isProposalDecisionTransitionAllowed,
  PROPOSAL_DECISION_STATUSES,
  PROPOSAL_MODERATION_STATUSES,
} from "../assets/shared/schemas/proposal-status";

describe("proposal decision transition policy", () => {
  it.each(PROPOSAL_MODERATION_STATUSES)("does not reopen a %s proposal with a recorded decision", (status) => {
    for (const nextStatus of PROPOSAL_DECISION_STATUSES) {
      expect(isProposalDecisionTransitionAllowed(status, "needs-work", nextStatus)).toBe(false);
    }
  });
});

describe("proposal route authorization policy", () => {
  it("maps canonical proposal resources to exact capabilities", () => {
    expect(proposalPermissionForRequest("/api/v1/proposals/p1/reviews", "GET")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/proposals/p1/reviews", "POST")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/proposals/p1/audit-log", "GET")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/proposals/p1/comments", "POST")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/proposals/p1/decisions", "POST")).toBe("proposals:manage");
    expect(proposalPermissionForRequest("/api/v1/proposals/p1/presentations/v1", "DELETE")).toBe("proposals:manage");
    expect(proposalPermissionAlternativesForRequest("/api/v1/proposals/p1", "PATCH")).toEqual([
      "proposals:manage",
      "proposals:edit_accepted_abstract",
    ]);
    expect(proposalPermissionAlternativesForRequest("/api/v1/proposals/p1/decisions", "POST")).toEqual([
      "proposals:manage",
    ]);
    expect(proposalPermissionForRequest("/api/v1/proposals/p1/cancellations", "POST")).toBe(
      "proposals:cancel_accepted",
    );
  });
});
