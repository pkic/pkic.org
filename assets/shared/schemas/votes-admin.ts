import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { VOTING_CATEGORY_LETTERS } from "./membership-categories";
import { workingGroupIdSchema } from "./working-groups";
import {
  VOTE_PROPOSALS_LIST_SORT_COLUMNS,
  candidateSummarySchema,
  proposalIdParamsSchema,
  proposalDetailResponseSchema,
  proposalSummarySchema,
  publicDetailLevelSchema,
  voteIdParamsSchema,
  voteProposalStatusSchema,
  voteScopeTypeSchema,
  voteStatusSchema,
  voteSummaryFieldsSchema,
  voteTypeSchema,
  voteVisibilitySchema,
  thresholdTypeSchema,
} from "./votes";

export const adminCandidateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  bio: z.string().trim().max(5000).optional(),
  userId: databaseIdSchema.nullable().optional(),
});

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

export const adminVoteSchema = z.object({
  ...voteSummaryFieldsSchema,
  candidates: z.array(candidateSummarySchema).nullable(),
});

export type VoteCandidateSummary = z.infer<typeof candidateSummarySchema>;
export type AdminVoteSummary = z.infer<typeof adminVoteSchema>;

export const adminVotesListResponseSchema = paginatedResponseSchema("votes", adminVoteSchema);

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

export const adminVoteCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10000).optional(),
  voteType: voteTypeSchema,
  scopeType: voteScopeTypeSchema,
  scopeId: workingGroupIdSchema.nullable().optional(),
  thresholdType: thresholdTypeSchema,
  eligibleCategories: z.array(z.enum(VOTING_CATEGORY_LETTERS)).nullable().optional(),
  opensAt: z.iso.datetime({ offset: true }).optional(),
  closesAt: z.iso.datetime({ offset: true }),
  candidates: z.array(adminCandidateInputSchema).max(50).optional(),
});

export const adminVoteCreateRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Create a vote directly (bypasses endorsement)",
  description: "Staff admin (any scope) or WG chair/vice-chair (their own WG only, enforced via votes:create).",
  request: { body: { content: { "application/json": { schema: adminVoteCreateSchema } }, required: true } },
  responses: {
    "200": {
      description: "Vote created.",
      content: { "application/json": { schema: z.object({ vote: z.object(voteSummaryFieldsSchema) }) } },
    },
    "403": { description: "Missing votes:create permission for this scope." },
    "422": { description: "Invalid candidates/threshold combination for the vote type." },
  },
};

export const adminVoteUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  opensAt: z.iso.datetime({ offset: true }).optional(),
  closesAt: z.iso.datetime({ offset: true }).optional(),
});

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
      content: { "application/json": { schema: z.object({ vote: z.object(voteSummaryFieldsSchema) }) } },
    },
    "404": { description: "Vote not found." },
    "409": { description: "Vote is already closed." },
  },
};

export const adminVoteVisibilityUpdateSchema = z.object({
  visibility: voteVisibilitySchema.optional(),
  publicDetailLevel: publicDetailLevelSchema.optional(),
});

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
      content: { "application/json": { schema: z.object({ vote: z.object(voteSummaryFieldsSchema) }) } },
    },
    "404": { description: "Vote not found." },
  },
};

export const adminBallotSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  choice: z.string(),
  round: z.number(),
  submittedAt: z.string(),
});

export type AdminVoteBallot = z.infer<typeof adminBallotSchema>;
export type AdminVoteProposalSummary = z.infer<typeof proposalSummarySchema>;

export const adminVoteBallotsRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Full ballot breakdown (staff only)",
  request: { params: voteIdParamsSchema },
  responses: {
    "200": {
      description: "Raw ballots, including voter identity.",
      content: { "application/json": { schema: z.object({ ballots: z.array(adminBallotSchema) }) } },
    },
    "404": { description: "Vote not found." },
  },
};

export const adminListProposalsQuerySchema = listQuerySchema(VOTE_PROPOSALS_LIST_SORT_COLUMNS).extend({
  status: voteProposalStatusSchema.optional(),
});

export const adminListProposalsRouteSchema = {
  tags: ["Admin Vote Proposals"],
  summary: "List all proposals, filterable by status/scope",
  request: { query: adminListProposalsQuerySchema },
  responses: {
    "200": {
      description: "Proposals.",
      content: { "application/json": { schema: paginatedResponseSchema("proposals", proposalSummarySchema) } },
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
          schema: z.object({ proposal: proposalSummarySchema, convertedVote: z.object(voteSummaryFieldsSchema) }),
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
      content: { "application/json": { schema: z.object({ proposal: proposalSummarySchema }) } },
    },
    "409": { description: "Proposal is not open for endorsement." },
  },
};
