import { jsonErrorResponse } from "./api-common";
import { groupReferenceParamsSchema } from "./groups";
import { groupVoteParamsSchema } from "./group-votes";
import {
  rawVoteBallotsListQuerySchema,
  rawVoteBallotsListResponseSchema,
  selectedGroupVoteCreateInputSchema,
  voteLifecycleTransitionResponseSchema,
  voteLifecycleTransitionSchema,
  voteMutationResponseSchema,
  voteUpdateInputSchema,
  voteVisibilityUpdateInputSchema,
} from "./vote-management";

export const groupVoteCreateRouteSchema = {
  tags: ["Group Vote Management"],
  summary: "Create a vote owned by the selected group",
  request: {
    params: groupReferenceParamsSchema,
    body: { content: { "application/json": { schema: selectedGroupVoteCreateInputSchema } }, required: true },
  },
  responses: {
    "200": { description: "Vote created.", content: { "application/json": { schema: voteMutationResponseSchema } } },
    "403": jsonErrorResponse("Effective vote-creation permission is required for the selected group."),
    "422": jsonErrorResponse("Invalid vote configuration."),
  },
};

export const groupVoteUpdateRouteSchema = {
  tags: ["Group Vote Management"],
  summary: "Update a vote through the selected group",
  request: {
    params: groupVoteParamsSchema,
    body: { content: { "application/json": { schema: voteUpdateInputSchema } }, required: true },
  },
  responses: {
    "200": { description: "Vote updated.", content: { "application/json": { schema: voteMutationResponseSchema } } },
    "403": jsonErrorResponse("The selected group does not provide vote-management access."),
    "409": jsonErrorResponse("Vote state or management access changed."),
  },
};

export const groupVoteVisibilityUpdateRouteSchema = {
  tags: ["Group Vote Management"],
  summary: "Update vote visibility through the selected group",
  request: {
    params: groupVoteParamsSchema,
    body: { content: { "application/json": { schema: voteVisibilityUpdateInputSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Vote visibility updated.",
      content: { "application/json": { schema: voteMutationResponseSchema } },
    },
    "403": jsonErrorResponse("The selected group does not provide vote-management access."),
    "409": jsonErrorResponse("Vote state or management access changed."),
  },
};

export const groupVoteBallotsAuditRouteSchema = {
  tags: ["Group Vote Management"],
  summary: "List identifiable ballots through the selected group",
  description: "This management-only audit surface may be used before or after voting closes.",
  request: { params: groupVoteParamsSchema, query: rawVoteBallotsListQuerySchema },
  responses: {
    "200": {
      description: "Raw ballots, including voter identity.",
      content: { "application/json": { schema: rawVoteBallotsListResponseSchema } },
    },
    "403": jsonErrorResponse("The selected group does not provide vote-management access."),
  },
};

export const groupVoteLifecycleTransitionRouteSchema = {
  tags: ["Group Vote Management"],
  summary: "Apply an explicit lifecycle transition through the selected group",
  description:
    "Transitions use the canonical vote state machine, exact-group management authorization, and atomic D1 guards.",
  request: {
    params: groupVoteParamsSchema,
    body: { content: { "application/json": { schema: voteLifecycleTransitionSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Vote lifecycle transition applied.",
      content: { "application/json": { schema: voteLifecycleTransitionResponseSchema } },
    },
    "403": jsonErrorResponse("The selected group does not provide vote-management access."),
    "409": jsonErrorResponse("Vote state or management access changed."),
    "422": jsonErrorResponse("The requested transition is not valid from the current state."),
  },
};

export {
  rawVoteBallotsListQuerySchema as groupVoteBallotsAuditQuerySchema,
  rawVoteBallotsListResponseSchema as groupVoteBallotsAuditResponseSchema,
  selectedGroupVoteCreateInputSchema as groupVoteCreateInputSchema,
  voteLifecycleTransitionResponseSchema as groupVoteLifecycleTransitionResponseSchema,
  voteLifecycleTransitionSchema as groupVoteLifecycleTransitionSchema,
  voteMutationResponseSchema as groupVoteMutationResponseSchema,
  voteUpdateInputSchema as groupVoteUpdateInputSchema,
  voteVisibilityUpdateInputSchema as groupVoteVisibilityUpdateInputSchema,
};
