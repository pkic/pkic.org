import type { MembershipWorkflowStep } from "./schemas/membership-workflows";

/** The same audience and destination explanation appears in configuration and application progress. */
export function membershipReviewSummary(step: MembershipWorkflowStep, labels: Readonly<Record<string, string>> = {}) {
  if (step.kind === "payment") return null;
  const who =
    step.kind === "staff_review"
      ? step.reviewerGroupId
        ? (labels[step.reviewerGroupId] ?? "Selected reviewer group")
        : "Staff with membership approval permission"
      : step.audience.kind === "active_voting_members"
        ? "Active voting members"
        : step.audience.kind === "executive_council"
          ? "Current Executive Council members"
          : (labels[step.audience.groupId] ?? "Selected reviewer group");
  const where =
    step.kind !== "consensus"
      ? null
      : step.destination.kind === "external"
        ? step.destination.email
        : (labels[step.destination.mailingListId] ?? "Selected managed mailing list");
  return { who, where };
}
