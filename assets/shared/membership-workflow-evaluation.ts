import type { MembershipWorkflowDefinition, MembershipWorkflowStep } from "./schemas/membership-workflows";

export interface MembershipStepEvidence {
  completedAt: string | null;
  reviewAccepted: boolean;
  noticeSentAt: string | null;
  noticeStatus: string | null;
  paidAt: string | null;
}
export interface MembershipObjectionEvidence {
  position: number;
  unresolved: boolean;
}
export type MembershipRequirementResult =
  | { complete: true; openedAt: string | null; deadlineAt: string | null }
  | { complete: false; openedAt: string | null; deadlineAt: string | null; blocker: string };

/** Decision policy only; dispatch, payment signatures, and actor authorization are server-owned evidence. */
export function evaluateMembershipRequirement(
  step: MembershipWorkflowStep,
  evidence: MembershipStepEvidence,
  unresolvedObjections: boolean,
  now: string,
): MembershipRequirementResult {
  if (step.kind === "payment") {
    return evidence.paidAt
      ? { complete: true, openedAt: null, deadlineAt: null }
      : {
          complete: false,
          openedAt: null,
          deadlineAt: null,
          blocker: "Waiting for verified payment of the required membership fee.",
        };
  }
  if (evidence.completedAt) return { complete: true, openedAt: null, deadlineAt: null };
  if (step.kind === "staff_review") {
    return evidence.reviewAccepted
      ? { complete: true, openedAt: null, deadlineAt: null }
      : {
          complete: false,
          openedAt: null,
          deadlineAt: null,
          blocker: "An authorized reviewer must complete this review.",
        };
  }
  if (!evidence.noticeSentAt || !["sent", "delivered"].includes(evidence.noticeStatus ?? "")) {
    return {
      complete: false,
      openedAt: null,
      deadlineAt: null,
      blocker: "The response window starts after the review notice is sent.",
    };
  }
  const deadlineAt = new Date(Date.parse(evidence.noticeSentAt) + step.durationDays * 86_400_000).toISOString();
  const window = { openedAt: evidence.noticeSentAt, deadlineAt };
  if (now < deadlineAt) return { ...window, complete: false, blocker: "The review response window is still open." };
  if (unresolvedObjections && step.objectionHandling === "hold_for_resolution") {
    return {
      ...window,
      complete: false,
      blocker: "Resolve or withdraw every objection before this review can finish.",
    };
  }
  return { ...window, complete: true };
}

/** The same ordered evaluation is used by staff decisions, payment callbacks, and scheduled work. */
export function evaluateMembershipWorkflow(
  definition: MembershipWorkflowDefinition,
  evidence: readonly MembershipStepEvidence[],
  objections: readonly MembershipObjectionEvidence[],
  now: string,
): {
  completedPositions: number[];
  currentPosition: number;
  readyToProvision: boolean;
  blocker: string | null;
  deadlineAt: string | null;
} {
  const completedPositions: number[] = [];
  for (let position = 0; position < definition.steps.length; position++) {
    const item = evidence[position];
    if (!item) throw new Error("Membership execution is missing required step evidence");
    const result = evaluateMembershipRequirement(
      definition.steps[position],
      item,
      objections.some((objection) => objection.unresolved && objection.position <= position),
      now,
    );
    if (!result.complete)
      return {
        completedPositions,
        currentPosition: position,
        readyToProvision: false,
        blocker: result.blocker,
        deadlineAt: result.deadlineAt,
      };
    if (!item.completedAt) completedPositions.push(position);
  }
  const unresolved = objections.some((objection) => objection.unresolved);
  return {
    completedPositions,
    currentPosition: definition.steps.length,
    readyToProvision: !unresolved,
    blocker: unresolved ? "Unresolved objections prevent membership approval." : null,
    deadlineAt: null,
  };
}
