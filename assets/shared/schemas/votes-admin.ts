import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  rawVoteBallotsListQuerySchema,
  rawVoteBallotsListResponseSchema,
  voteCreateInputSchema,
  voteMutationResponseSchema,
  voteUpdateInputSchema,
  voteVisibilityUpdateInputSchema,
} from "./vote-management";
import { candidateSummarySchema, voteIdParamsSchema, voteStatusSchema, voteSummaryFieldsSchema } from "./votes";

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

export const adminVoteCreateRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Create a vote directly (bypasses endorsement)",
  description: "Consortium administrators or effective group leadership with votes:create for the owning group.",
  request: { body: { content: { "application/json": { schema: voteCreateInputSchema } }, required: true } },
  responses: {
    "200": {
      description: "Vote created.",
      content: { "application/json": { schema: voteMutationResponseSchema } },
    },
    "403": { description: "Missing votes:create permission for this scope." },
    "422": { description: "Invalid candidates/threshold combination for the vote type." },
  },
};

export const adminVoteUpdateRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Update a vote's settings",
  request: {
    params: voteIdParamsSchema,
    body: { content: { "application/json": { schema: voteUpdateInputSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Vote updated.",
      content: { "application/json": { schema: voteMutationResponseSchema } },
    },
    "404": { description: "Vote not found." },
    "409": { description: "Vote is already closed." },
  },
};

export const adminVoteVisibilityUpdateRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Set a vote's public visibility and detail level",
  description: "Reversible at any time. Every change is written to audit_log.",
  request: {
    params: voteIdParamsSchema,
    body: { content: { "application/json": { schema: voteVisibilityUpdateInputSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Visibility updated.",
      content: { "application/json": { schema: voteMutationResponseSchema } },
    },
    "404": { description: "Vote not found." },
  },
};
export const adminVoteBallotsRouteSchema = {
  tags: ["Admin Votes"],
  summary: "Full ballot breakdown for authorized vote managers",
  description: "This audited management surface may be used before or after voting closes.",
  request: { params: voteIdParamsSchema, query: rawVoteBallotsListQuerySchema },
  responses: {
    "200": {
      description: "Raw ballots, including voter identity.",
      content: { "application/json": { schema: rawVoteBallotsListResponseSchema } },
    },
    "404": { description: "Vote not found." },
  },
};
