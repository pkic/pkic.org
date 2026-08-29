import { z } from "zod";
import { jsonErrorResponse } from "./api-common";
import { groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema } from "./pagination";
import { voteGroupGrantSchemas } from "./resource-grants";
import {
  memberVoteSchema,
  submitBallotResponseSchema,
  submitBallotSchema,
  voteFullResultSchema,
  voteSummaryFieldsSchema,
  votesListQuerySchema,
} from "./votes";
import { voteLifecycleTransitionNameSchema } from "./vote-management";
import { requiresSession } from "./route-contract";

const voteCapabilitiesSchema = z
  .array(voteGroupGrantSchemas.capabilitySchema)
  .max(voteGroupGrantSchemas.capabilities.length);
export const availableVoteTransitionsSchema = z.array(voteLifecycleTransitionNameSchema).max(3).default([]);

export const groupVotesListQuerySchema = votesListQuerySchema;
export type GroupVotesListQuery = z.infer<typeof groupVotesListQuerySchema>;

export const groupVoteSchema = z.object({
  ...voteSummaryFieldsSchema,
  capabilities: voteCapabilitiesSchema,
  availableTransitions: availableVoteTransitionsSchema,
});
export type GroupVote = z.infer<typeof groupVoteSchema>;
export const groupVotesListResponseSchema = paginatedResponseSchema("votes", groupVoteSchema);

export const groupVoteParamsSchema = groupReferenceParamsSchema.extend({ voteId: databaseIdSchema });
export const groupVoteDetailSchema = memberVoteSchema.extend({
  capabilities: voteCapabilitiesSchema,
  availableTransitions: availableVoteTransitionsSchema,
});
export type GroupVoteDetail = z.infer<typeof groupVoteDetailSchema>;
export const groupVoteDetailResponseSchema = z.object({ vote: groupVoteDetailSchema });

export const groupVotesListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List votes available through a group",
  description: "Access filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { params: groupReferenceParamsSchema, query: groupVotesListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of group-owned and explicitly shared votes.",
      content: { "application/json": { schema: groupVotesListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupVoteDetailRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Get a vote through one group context",
  request: { params: groupVoteParamsSchema },
  responses: {
    "200": {
      description: "Vote detail, participation state, and effective capabilities in the selected group.",
      content: { "application/json": { schema: groupVoteDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("Vote not found or not visible through this group."),
  },
};

export const groupVoteBallotRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Cast or update a ballot through one group context",
  request: {
    params: groupVoteParamsSchema,
    body: { content: { "application/json": { schema: submitBallotSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Ballot recorded.",
      content: { "application/json": { schema: submitBallotResponseSchema } },
    },
    "403": jsonErrorResponse("The selected group does not provide participation access."),
    "409": jsonErrorResponse("Vote eligibility or state changed."),
    "422": jsonErrorResponse("Invalid ballot."),
  },
};

export const groupVoteResultsResponseSchema = z.object({ result: voteFullResultSchema });
export const groupVoteResultsRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Get closed-vote results through one group context",
  request: { params: groupVoteParamsSchema },
  responses: {
    "200": {
      description: "Full result detail.",
      content: { "application/json": { schema: groupVoteResultsResponseSchema } },
    },
    "404": jsonErrorResponse("Vote results are not visible through this group."),
    "409": jsonErrorResponse("Results are hidden until the vote closes."),
  },
};
