import { z } from "zod";

export const PROPOSAL_DECISION_STATUSES = ["accepted", "rejected", "needs-work"] as const;
export const proposalDecisionStatusSchema = z.enum(PROPOSAL_DECISION_STATUSES);

export const PROPOSAL_FLAG_ACTIONS = ["spam", "duplicate", "delete"] as const;
export const proposalFlagActionSchema = z.enum(PROPOSAL_FLAG_ACTIONS);

export function isProposalDecisionStatus(value: string): value is z.infer<typeof proposalDecisionStatusSchema> {
  return proposalDecisionStatusSchema.safeParse(value).success;
}

export const proposalFlagRequestSchema = z.object({
  action: proposalFlagActionSchema,
});

export const proposalFlagResponseSchema = z.object({
  success: z.literal(true),
  action: proposalFlagActionSchema,
});

export type ProposalFlagAction = z.infer<typeof proposalFlagActionSchema>;
