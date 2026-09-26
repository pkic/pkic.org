import { z } from "zod";
import { successResponseSchema } from "./api-common";

/** Rendered notification preview for a proposed program decision. */
export const proposalDecisionPreviewMessageSchema = z.object({
  id: z.string(),
  templateKey: z.string(),
  recipientEmail: z.string(),
  recipientLabel: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  templateMissing: z.boolean(),
});

/** Read-only preview of the notifications a proposal decision would send. */
export const proposalDecisionPreviewResponseSchema = successResponseSchema.extend({
  recipientCount: z.number().int().nonnegative(),
  emailCount: z.number().int().nonnegative(),
  layoutMissing: z.boolean(),
  missingTemplateKeys: z.array(z.string()),
  messages: z.array(proposalDecisionPreviewMessageSchema),
});

export type ProposalDecisionPreviewResponse = z.infer<typeof proposalDecisionPreviewResponseSchema>;
