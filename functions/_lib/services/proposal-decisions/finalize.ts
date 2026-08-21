import type { ProposalDecisionStatus } from "../../../../assets/shared/schemas/proposal-status";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { buildProposalDecisionEmailPlan } from "./email-plan";
import { recordProposalDecision } from "./record";

export async function finalizeProposalWithNotifications(
  db: DatabaseLike,
  input: {
    proposalId: string;
    actor: AuthAdmin;
    finalStatus: ProposalDecisionStatus;
    decisionNote?: string;
    minReviewsRequired: number;
    presentationDeadline?: string;
  },
  options: Parameters<typeof buildProposalDecisionEmailPlan>[2],
) {
  const plan = await buildProposalDecisionEmailPlan(db, input, options);
  return recordProposalDecision(db, {
    ...input,
    expectedProposalUpdatedAt: plan.proposal.updated_at,
    expectedEventSnapshot: plan.eventSnapshot,
    expectedSpeakerSnapshot: plan.speakerSnapshot,
    presentationReminderUserIds: plan.presentationReminderUserIds,
    notifications: plan.messages,
  });
}
