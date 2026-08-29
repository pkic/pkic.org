import { z } from "zod";
import { eventIdSchema, jsonErrorResponse } from "./api-common";
import { proposalAccessSchema } from "./event-proposals";
import { eventSummarySchema } from "./event-read-models";
import { groupIdSchema, groupSummarySchema } from "./groups";
import { listQuerySchema, paginatedResponseSchema, sortColumnSchemaWithDefault } from "./pagination";

export const PROPOSAL_PROGRAM_SORT_COLUMNS = ["groupName", "eventName", "startsAt"] as const;
export const proposalProgramsListQuerySchema = listQuerySchema(PROPOSAL_PROGRAM_SORT_COLUMNS).extend({
  sort: sortColumnSchemaWithDefault(PROPOSAL_PROGRAM_SORT_COLUMNS, "eventName"),
  groupId: groupIdSchema.optional(),
  eventId: eventIdSchema.optional(),
});
export type ProposalProgramsListQuery = z.infer<typeof proposalProgramsListQuerySchema>;

/** A narrow portal selector for group-owned event programs the caller may read. */
export const proposalProgramSchema = z.object({
  group: groupSummarySchema,
  event: eventSummarySchema.extend({ startsAt: z.string().nullable() }),
  access: proposalAccessSchema,
});
export type ProposalProgram = z.infer<typeof proposalProgramSchema>;

export const proposalProgramsListResponseSchema = paginatedResponseSchema("programs", proposalProgramSchema);

export const proposalProgramsListRouteSchema = {
  tags: ["Proposal programs"],
  summary: "List proposal programs available to the current user",
  "x-pkic-auth": { required: true },
  description:
    "Returns only group-owned event programs for which the caller has event-scoped proposals:read. Other proposal capabilities remain independent and do not grant read access. This does not grant generic group visibility or management.",
  request: { query: proposalProgramsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded server-filtered proposal-program page.",
      content: { "application/json": { schema: proposalProgramsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal management identity is required."),
  },
};
