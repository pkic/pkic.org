import { z } from "zod";
import { tokenSchema, trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { defaultedSourceTypeSchema } from "./source";

/** Original proposal-entry context shared by the initial form and its mailbox continuation. */
export const proposalEntryContextShape = {
  inviteToken: tokenSchema.optional(),
  inviteId: databaseIdSchema.optional(),
  sourceType: defaultedSourceTypeSchema,
  sourceRef: trimmedString(2, 200).optional(),
  referralCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{6,12}$/)
    .optional(),
};
export const proposalEntryContextSchema = z.object(proposalEntryContextShape).strict();
export type ProposalEntryContext = z.infer<typeof proposalEntryContextSchema>;
