import { z } from "zod";
import { jsonErrorResponse } from "./api-common";
import { groupReferenceParamsSchema } from "./groups";
import { paginatedResponseSchema } from "./pagination";
import { voteGroupGrantSchemas } from "./resource-grants";
import { portalVotesListQuerySchema, voteSummaryFieldsSchema, voteTypeSchema } from "./votes";

export const groupVotesListQuerySchema = portalVotesListQuerySchema.extend({ type: voteTypeSchema.optional() });
export type GroupVotesListQuery = z.infer<typeof groupVotesListQuerySchema>;

export const groupVoteSchema = z.object({
  ...voteSummaryFieldsSchema,
  capabilities: z.array(voteGroupGrantSchemas.capabilitySchema).max(voteGroupGrantSchemas.capabilities.length),
});
export type GroupVote = z.infer<typeof groupVoteSchema>;
export const groupVotesListResponseSchema = paginatedResponseSchema("votes", groupVoteSchema);

export const groupVotesListRouteSchema = {
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
