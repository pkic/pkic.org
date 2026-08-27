import { z } from "zod";
import { successResponseSchema } from "./api-common";

export const PROPOSAL_DECISION_STATUSES = ["accepted", "rejected", "needs-work"] as const;
export const proposalDecisionStatusSchema = z.enum(PROPOSAL_DECISION_STATUSES);

export const PROPOSAL_DECIDABLE_STATUSES = ["submitted", "resubmitted", "under_review"] as const;
export const proposalDecidableStatusSchema = z.enum(PROPOSAL_DECIDABLE_STATUSES);

export const PROPOSAL_SELF_SERVICE_EDITABLE_STATUSES = [...PROPOSAL_DECIDABLE_STATUSES, "needs-work"] as const;
export const proposalSelfServiceEditableStatusSchema = z.enum(PROPOSAL_SELF_SERVICE_EDITABLE_STATUSES);
export const PROPOSAL_SPEAKER_ROSTER_EDITABLE_STATUSES = [
  ...PROPOSAL_SELF_SERVICE_EDITABLE_STATUSES,
  "accepted",
] as const;
export const proposalSpeakerRosterEditableStatusSchema = z.enum(PROPOSAL_SPEAKER_ROSTER_EDITABLE_STATUSES);
export const PROPOSAL_REPLACEMENT_PROPOSER_STATUSES = ["invited", "confirmed"] as const;

export const PROPOSAL_MODERATION_STATUSES = ["withdrawn", "canceled", "spam", "duplicate", "deleted"] as const;
export const PROPOSAL_STATUSES = [
  ...PROPOSAL_DECIDABLE_STATUSES,
  ...PROPOSAL_DECISION_STATUSES,
  ...PROPOSAL_MODERATION_STATUSES,
] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export const PROPOSAL_INACTIVE_STATUSES = [
  "withdrawn",
  "canceled",
  "rejected",
  "spam",
  "duplicate",
  "deleted",
] as const;
export const PROPOSAL_ADMIN_STATUS_FILTERS = [
  "active",
  ...PROPOSAL_DECIDABLE_STATUSES,
  ...PROPOSAL_DECISION_STATUSES,
  "withdrawn",
  "canceled",
  "spam",
  "duplicate",
] as const;
export const proposalAdminStatusFilterSchema = z.enum(PROPOSAL_ADMIN_STATUS_FILTERS);

export const PROPOSAL_FLAG_ACTIONS = ["spam", "duplicate", "delete"] as const;
export const proposalFlagActionSchema = z.enum(PROPOSAL_FLAG_ACTIONS);

export function isProposalDecisionStatus(value: string): value is z.infer<typeof proposalDecisionStatusSchema> {
  return proposalDecisionStatusSchema.safeParse(value).success;
}

export function isProposalDecidableStatus(value: string): value is z.infer<typeof proposalDecidableStatusSchema> {
  return proposalDecidableStatusSchema.safeParse(value).success;
}

/**
 * Canonical admin-decision transition policy.
 *
 * A needs-work decision leaves the proposal open for a proposer revision. If
 * no revision arrives, an administrator may close that same review round with
 * a rejection. That is a superseding administrative decision, not a proposer
 * withdrawal and not a new review round.
 */
export function isProposalDecisionTransitionAllowed(
  proposalStatus: string,
  currentDecisionStatus: string | null | undefined,
  nextDecisionStatus: ProposalDecisionStatus,
): boolean {
  if (isProposalDecidableStatus(proposalStatus)) return currentDecisionStatus == null;
  return proposalStatus === "needs-work" && currentDecisionStatus === "needs-work" && nextDecisionStatus === "rejected";
}

export function isProposalSelfServiceEditableStatus(
  value: string,
): value is z.infer<typeof proposalSelfServiceEditableStatusSchema> {
  return proposalSelfServiceEditableStatusSchema.safeParse(value).success;
}

export function isProposalSpeakerRosterEditableStatus(
  value: string,
): value is z.infer<typeof proposalSpeakerRosterEditableStatusSchema> {
  return proposalSpeakerRosterEditableStatusSchema.safeParse(value).success;
}

export function isProposalInactiveStatus(value: string): boolean {
  return (PROPOSAL_INACTIVE_STATUSES as readonly string[]).includes(value);
}

export function isEligibleReplacementProposerStatus(value: string): boolean {
  return (PROPOSAL_REPLACEMENT_PROPOSER_STATUSES as readonly string[]).includes(value);
}

export const proposalFlagRequestSchema = z.object({
  action: proposalFlagActionSchema,
});

export const proposalFlagResponseSchema = successResponseSchema.extend({
  action: proposalFlagActionSchema,
});

export type ProposalFlagAction = z.infer<typeof proposalFlagActionSchema>;
export type ProposalDecisionStatus = z.infer<typeof proposalDecisionStatusSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
