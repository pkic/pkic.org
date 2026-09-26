/** Read-only ownership feed. Canonical event routes open session-owned records;
 * emailed capability tokens and URLs must never appear in this projection. */
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventSummarySchema } from "./event-read-models";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, listQuerySchema } from "./pagination";
import { proposalStatusSchema } from "./proposal-status";

/** "submitter" when the caller is the proposal's proposer_user_id, "speaker" for any other listed role. */
export const CURRENT_USER_PROPOSAL_ROLES = ["submitter", "speaker"] as const;
export const currentUserProposalRoleSchema = z.enum(CURRENT_USER_PROPOSAL_ROLES);
export type CurrentUserProposalRole = z.infer<typeof currentUserProposalRoleSchema>;

export const currentUserProposalSchema = z.object({
  id: databaseIdSchema,
  event: eventSummarySchema,
  title: z.string(),
  status: proposalStatusSchema,
  role: currentUserProposalRoleSchema,
  updatedAt: utcInstantSchema,
});
export type CurrentUserProposal = z.infer<typeof currentUserProposalSchema>;

export const currentUserProposalsListQuerySchema = listQuerySchema(["title", "updated_at", "status"] as const).extend({
  eventId: databaseIdSchema.optional(),
});
export type CurrentUserProposalsListQuery = z.infer<typeof currentUserProposalsListQuerySchema>;

export const currentUserProposalsListResponseSchema = paginatedResponseSchema("proposals", currentUserProposalSchema);
export type CurrentUserProposalsListResponse = z.infer<typeof currentUserProposalsListResponseSchema>;
