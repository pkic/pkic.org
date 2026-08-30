/**
 * Identity-first participation feed: a READ-ONLY projection of the caller's
 * own event proposals, as submitter or listed speaker (see
 * IMPLEMENTATION_TRACKER.md section 13, "Participation records").
 *
 * CRITICAL BOUNDARY (see ARCHITECTURE.md): proposal self-service authority
 * lives entirely in signed capability links (manage tokens), which must
 * never leak through a session. This schema deliberately carries no token,
 * capability URL, or manage-link field and enables no mutation — the portal
 * pairs it with a separate "resend my access link" action that goes through
 * the existing capability machinery instead.
 */
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventSummarySchema } from "./event-read-models";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, paginationQuerySchemaWithDefaults } from "./pagination";
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

export const currentUserProposalsListQuerySchema = paginationQuerySchemaWithDefaults();
export type CurrentUserProposalsListQuery = z.infer<typeof currentUserProposalsListQuerySchema>;

export const currentUserProposalsListResponseSchema = paginatedResponseSchema("proposals", currentUserProposalSchema);
export type CurrentUserProposalsListResponse = z.infer<typeof currentUserProposalsListResponseSchema>;
