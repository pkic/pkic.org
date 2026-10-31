import type { ApplicationStage } from "./schemas/member-applications";

/**
 * What an applicant can expect after each application stage, in their words.
 * One place for this copy, so the status page and any later applicant surface
 * say the same thing about the same stage.
 */
const APPLICATION_STAGE_NEXT_STEPS: Record<ApplicationStage, string> = {
  submitted:
    "We have your application. The membership team will review it and email you when it moves to the next stage.",
  processing:
    "The membership team is reviewing your application. We will email you when a requirement needs your action or a decision is made.",
  on_hold:
    "Your application is paused until we hear from you. Our latest email explains what we need; contact the membership team if you cannot find it.",
  approved:
    "Welcome to the PKI Consortium. Sign in to the member portal with the email address you applied with to set up your profile.",
  declined: "Your application was not approved. Contact the membership team if you have questions about the decision.",
  withdrawn: "This application was withdrawn. You are welcome to apply again at any time.",
};

export function applicationStageNextStep(stage: ApplicationStage): string {
  return APPLICATION_STAGE_NEXT_STEPS[stage];
}
