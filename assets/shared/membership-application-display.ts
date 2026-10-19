import type { MembershipApplicationSummary } from "./schemas/membership-application-management";
import { statusLabel } from "./status-display";

/** A lifecycle such as processing is not the review step the reader needs to see. */
export function membershipApplicationStageLabel(
  application: Pick<MembershipApplicationSummary, "stage" | "currentRequirement">,
): string {
  if (application.stage === "submitted" || application.stage === "processing") {
    return application.currentRequirement || (application.stage === "submitted" ? "Submitted" : "Review pending");
  }
  if (application.stage === "on_hold" && application.currentRequirement) {
    return `On hold: ${application.currentRequirement}`;
  }
  return statusLabel(application.stage);
}

/**
 * The tone of an application's stage: the state it is in, never its position
 * in the workflow. Every review step is in flight (blue), whatever its name.
 */
const MEMBERSHIP_APPLICATION_STAGE_TONE = {
  submitted: "neutral",
  processing: "info",
  on_hold: "warn",
  approved: "ok",
  declined: "danger",
  withdrawn: "danger",
} as const satisfies Record<MembershipApplicationSummary["stage"], string>;

export function membershipApplicationStageTone(
  application: Pick<MembershipApplicationSummary, "stage">,
): (typeof MEMBERSHIP_APPLICATION_STAGE_TONE)[keyof typeof MEMBERSHIP_APPLICATION_STAGE_TONE] {
  return MEMBERSHIP_APPLICATION_STAGE_TONE[application.stage];
}
