import { describe, expect, it } from "vitest";
import {
  membershipWorkflowDefinitionSchema,
  type MembershipWorkflowDefinition,
} from "../../assets/shared/schemas/membership-workflows";
import {
  evaluateMembershipWorkflow,
  type MembershipStepEvidence,
} from "../../assets/shared/membership-workflow-evaluation";

const now = "2026-09-17T12:00:00.000Z";
const empty: MembershipStepEvidence = {
  completedAt: null,
  reviewAccepted: false,
  noticeSentAt: null,
  noticeStatus: null,
  paidAt: null,
};
const standard: MembershipWorkflowDefinition = {
  name: "Standard membership",
  policyReference: "Adopted membership policy",
  steps: [
    {
      id: "11111111111111111111111111111111",
      label: "Staff review",
      instructions: "Review the application form and organization details.",
      kind: "staff_review",
      reviewerGroupId: null,
    },
    {
      id: "22222222222222222222222222222222",
      label: "Member consultation",
      instructions: "Members may raise an objection.",
      kind: "consensus",
      audience: { kind: "active_voting_members" },
      destination: { kind: "external", email: "consultation@example.test" },
      durationDays: 7,
      objectionHandling: "hold_for_resolution",
    },
  ],
};
const completedReview = { ...empty, reviewAccepted: true };
const sent = { ...empty, noticeSentAt: "2026-09-10T12:00:00.000Z", noticeStatus: "sent" };

describe("membership workflow policy", () => {
  it("waits for staff evidence before opening the next requirement", () => {
    expect(evaluateMembershipWorkflow(standard, [empty, sent], [], now)).toMatchObject({
      currentPosition: 0,
      readyToProvision: false,
      completedPositions: [],
    });
  });
  it.each(["queued", "retrying", "failed", "delivery_unknown", "bounced", "sending"])(
    "does not count %s as a sent notice",
    (noticeStatus) => {
      expect(evaluateMembershipWorkflow(standard, [completedReview, { ...sent, noticeStatus }], [], now)).toMatchObject(
        { currentPosition: 1, readyToProvision: false, deadlineAt: null },
      );
    },
  );
  it("gives delayed dispatch the entire response window, to millisecond precision", () => {
    expect(
      evaluateMembershipWorkflow(
        standard,
        [completedReview, { ...sent, noticeSentAt: "2026-09-10T12:00:00.001Z" }],
        [],
        now,
      ),
    ).toMatchObject({ readyToProvision: false, deadlineAt: "2026-09-17T12:00:00.001Z" });
    expect(evaluateMembershipWorkflow(standard, [completedReview, sent], [], now).readyToProvision).toBe(true);
  });
  it("holds an unresolved objection and permits progress after an attributed resolution", () => {
    expect(
      evaluateMembershipWorkflow(standard, [completedReview, sent], [{ position: 1, unresolved: true }], now)
        .readyToProvision,
    ).toBe(false);
    expect(
      evaluateMembershipWorkflow(standard, [completedReview, sent], [{ position: 1, unresolved: false }], now)
        .readyToProvision,
    ).toBe(true);
  });
  it("does not let referral to another review bypass final objection resolution", () => {
    const definition = structuredClone(standard);
    if (definition.steps[1].kind !== "consensus") throw new Error("fixture");
    definition.steps[1].objectionHandling = "refer_next";
    definition.steps.push({ ...definition.steps[0], id: "33333333333333333333333333333333" });
    expect(membershipWorkflowDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(
      evaluateMembershipWorkflow(
        definition,
        [completedReview, sent, completedReview],
        [{ position: 1, unresolved: true }],
        now,
      ),
    ).toMatchObject({ readyToProvision: false, currentPosition: 3 });
  });
  it("rejects a terminal referral and duplicate step identities", () => {
    const definition = structuredClone(standard);
    if (definition.steps[1].kind !== "consensus") throw new Error("fixture");
    definition.steps[1].objectionHandling = "refer_next";
    definition.steps[1].id = definition.steps[0].id;
    const result = membershipWorkflowDefinitionSchema.safeParse(definition);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toHaveLength(2);
  });
  it("supports payment-only membership without any EC stage", () => {
    const paid: MembershipWorkflowDefinition = {
      name: "Paid organization membership",
      policyReference: "Future adopted fee policy",
      steps: [
        {
          id: "44444444444444444444444444444444",
          label: "Membership fee",
          instructions: "Pay the required fee for Example Organization.",
          kind: "payment",
          feeReference: "organization-annual-fee",
          amount: 10000,
          currency: "usd",
          deadlineDays: 30,
        },
      ],
    };
    expect(evaluateMembershipWorkflow(paid, [empty], [], now).readyToProvision).toBe(false);
    expect(evaluateMembershipWorkflow(paid, [{ ...empty, paidAt: now }], [], now)).toMatchObject({
      readyToProvision: true,
      completedPositions: [0],
    });
  });
});
