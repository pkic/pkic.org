import { z } from "zod";

export const PROPOSAL_DECISION_STATUSES = ["accepted", "rejected", "needs-work"] as const;
export const proposalDecisionStatusSchema = z.enum(PROPOSAL_DECISION_STATUSES);

export const PROPOSAL_DECIDABLE_STATUSES = ["submitted", "resubmitted", "under_review"] as const;
export const proposalDecidableStatusSchema = z.enum(PROPOSAL_DECIDABLE_STATUSES);

export const PROPOSAL_SELF_SERVICE_EDITABLE_STATUSES = [...PROPOSAL_DECIDABLE_STATUSES, "needs-work"] as const;
export const proposalSelfServiceEditableStatusSchema = z.enum(PROPOSAL_SELF_SERVICE_EDITABLE_STATUSES);

export const PROPOSAL_MODERATION_STATUSES = ["withdrawn", "spam", "duplicate", "deleted"] as const;
export const PROPOSAL_STATUSES = [
  ...PROPOSAL_DECIDABLE_STATUSES,
  ...PROPOSAL_DECISION_STATUSES,
  ...PROPOSAL_MODERATION_STATUSES,
] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export const PROPOSAL_INACTIVE_STATUSES = ["withdrawn", "rejected", "spam", "duplicate", "deleted"] as const;
export const PROPOSAL_ADMIN_STATUS_FILTERS = [
  "active",
  ...PROPOSAL_DECIDABLE_STATUSES,
  ...PROPOSAL_DECISION_STATUSES,
  "withdrawn",
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

export function isProposalSelfServiceEditableStatus(
  value: string,
): value is z.infer<typeof proposalSelfServiceEditableStatusSchema> {
  return proposalSelfServiceEditableStatusSchema.safeParse(value).success;
}

export const proposalFlagRequestSchema = z.object({
  action: proposalFlagActionSchema,
});

export const proposalFlagResponseSchema = z.object({
  success: z.literal(true),
  action: proposalFlagActionSchema,
});

export type ProposalFlagAction = z.infer<typeof proposalFlagActionSchema>;
export type ProposalDecisionStatus = z.infer<typeof proposalDecisionStatusSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
