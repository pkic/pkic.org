import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { groupIdSchema } from "./groups";
import {
  RAW_VOTE_BALLOT_SORT_COLUMNS,
  rawVoteBallotSchema,
  rawVoteBallotsListQuerySchema,
  rawVoteBallotsListResponseSchema,
  voteCandidateInputSchema,
  voteCreateInputSchema,
  voteMutationResponseSchema,
  voteUpdateInputSchema,
  voteVisibilityUpdateInputSchema,
} from "./vote-management";
import {
  VOTE_PROPOSALS_LIST_SORT_COLUMNS,
  candidateSummarySchema,
  proposalIdParamsSchema,
  proposalDetailResponseSchema,
  proposalSummarySchema,
  voteIdParamsSchema,
  voteProposalStatusSchema,
  voteStatusSchema,
  voteSummaryFieldsSchema,
} from "./votes";

export const adminCandidateInputSchema = voteCandidateInputSchema;

export const ADMIN_VOTES_SORT_COLUMNS = [
  "title",
  "vote_type",
  "status",
  "opens_at",
  "closes_at",
  "created_at",
] as const;

export const adminVotesListQuerySchema = listQuerySchema(ADMIN_VOTES_SORT_COLUMNS).extend({
  status: voteStatusSchema.optional(),
});
export type AdminVotesListQuery = z.infer<typeof adminVotesListQuerySchema>;

export const adminVoteSchema = z.object({
  ...voteSummaryFieldsSchema,
  candidates: z.array(candidateSummarySchema).nullable(),
});
/** Backward-compatible route names backed by the canonical management contracts. */
export const adminVoteMutationResponseSchema = voteMutationResponseSchema;
export const adminVoteResponseSchema = z.object({ vote: adminVoteSchema });

export type VoteCandidateSummary = z.infer<typeof candidateSummarySchema>;
export type AdminVoteSummary = z.infer<typeof adminVoteSchema>;

export const adminVotesListResponseSchema = paginatedResponseSchema("votes", adminVoteSchema);
export type AdminVotesListResponse = z.infer<typeof adminVotesListResponseSchema>;

export const adminVotesListRouteSchema = {
  tags: ["Admin Votes"],
  summary: "List all votes, optionally filtered by status",
  request: { query: adminVotesListQuerySchema },
  responses: {
    "200": {
      description: "Votes.",
      content: { "application/json": { schema: adminVotesListResponseSchema } },
    },
  },
};

export const adminVoteCreateSchema = voteCreateInputSchema;

export const adminVoteCreateRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Create a vote directly (bypasses endorsement)",
  description: "Consortium administrators or effective group leadership with votes:create for the owning group.",
  request: { body: { content: { "application/json": { schema: adminVoteCreateSchema } }, required: true } },
  responses: {
    "200": {
      description: "Vote created.",
      content: { "application/json": { schema: adminVoteMutationResponseSchema } },
    },
    "403": { description: "Missing votes:create permission for this scope." },
    "422": { description: "Invalid candidates/threshold combination for the vote type." },
  },
};

export const adminVoteUpdateSchema = voteUpdateInputSchema;

export const adminVoteUpdateRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Update a vote's settings",
  request: {
    params: voteIdParamsSchema,
    body: { content: { "application/json": { schema: adminVoteUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Vote updated.",
      content: { "application/json": { schema: adminVoteMutationResponseSchema } },
    },
    "404": { description: "Vote not found." },
    "409": { description: "Vote is already closed." },
  },
};

export const adminVoteVisibilityUpdateSchema = voteVisibilityUpdateInputSchema;

export const adminVoteVisibilityUpdateRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Set a vote's public visibility and detail level",
  description: "Reversible at any time. Every change is written to audit_log.",
  request: {
    params: voteIdParamsSchema,
    body: { content: { "application/json": { schema: adminVoteVisibilityUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Visibility updated.",
      content: { "application/json": { schema: adminVoteMutationResponseSchema } },
    },
    "404": { description: "Vote not found." },
  },
};
export const adminVoteProposalApproveResponseSchema = z.object({
  proposal: proposalSummarySchema,
  convertedVote: z.object(voteSummaryFieldsSchema),
});
export const adminVoteProposalRejectResponseSchema = z.object({ proposal: proposalSummarySchema });

export const adminBallotSchema = rawVoteBallotSchema;

export type AdminVoteBallot = z.infer<typeof adminBallotSchema>;
export type AdminVoteProposalSummary = z.infer<typeof proposalSummarySchema>;

export const ADMIN_VOTE_BALLOT_SORT_COLUMNS = RAW_VOTE_BALLOT_SORT_COLUMNS;
export const adminVoteBallotsListQuerySchema = rawVoteBallotsListQuerySchema;
export type AdminVoteBallotsListQuery = z.infer<typeof adminVoteBallotsListQuerySchema>;

export const adminVoteBallotsListResponseSchema = rawVoteBallotsListResponseSchema;
export type AdminVoteBallotsListResponse = z.infer<typeof adminVoteBallotsListResponseSchema>;

export const adminVoteBallotsRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Full ballot breakdown for authorized vote managers",
  description: "This audited management surface may be used before or after voting closes.",
  request: { params: voteIdParamsSchema, query: adminVoteBallotsListQuerySchema },
  responses: {
    "200": {
      description: "Raw ballots, including voter identity.",
      content: { "application/json": { schema: adminVoteBallotsListResponseSchema } },
    },
    "404": { description: "Vote not found." },
  },
};

export const adminListProposalsQuerySchema = listQuerySchema(VOTE_PROPOSALS_LIST_SORT_COLUMNS).extend({
  ownerGroupId: groupIdSchema.optional(),
  status: voteProposalStatusSchema.optional(),
});
export type AdminListProposalsQuery = z.infer<typeof adminListProposalsQuerySchema>;
export const adminVoteProposalsListResponseSchema = paginatedResponseSchema("proposals", proposalSummarySchema);
export const adminVoteProposalDetailResponseSchema = proposalDetailResponseSchema;

export const adminListProposalsRouteSchema = {
  tags: ["Admin Vote Proposals"],
  summary: "List all proposals, filterable by status and owning group",
  request: { query: adminListProposalsQuerySchema },
  responses: {
    "200": {
      description: "Proposals.",
      content: { "application/json": { schema: adminVoteProposalsListResponseSchema } },
    },
  },
};

export const adminProposalDetailRouteSchema = {
  tags: ["Admin Vote Proposals"],
  summary: "Proposal detail + endorsers",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Proposal detail.",
      content: {
        "application/json": { schema: proposalDetailResponseSchema },
      },
    },
    "404": { description: "Proposal not found." },
  },
};

export const adminApproveProposalRouteSchema = {
  tags: ["Admin Vote Proposals"],
  summary: "Convert a proposal to an active vote, bypassing the endorsement count",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Converted.",
      content: {
        "application/json": {
          schema: adminVoteProposalApproveResponseSchema,
        },
      },
    },
    "409": { description: "Proposal is not open for endorsement." },
  },
};

export const adminRejectProposalSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

export const adminRejectProposalRouteSchema = {
  tags: ["Admin Vote Proposals"],
  summary: "Reject a proposal with a reason; notifies the proposer",
  request: {
    params: proposalIdParamsSchema,
    body: { content: { "application/json": { schema: adminRejectProposalSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Rejected.",
      content: { "application/json": { schema: adminVoteProposalRejectResponseSchema } },
    },
    "409": { description: "Proposal is not open for endorsement." },
  },
};
