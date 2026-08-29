import { jsonErrorResponse, eventIdSchema } from "./api-common";
import { eventProposalsListQuerySchema, eventProposalsResponseSchema } from "./event-proposals";
import { groupReferenceParamsSchema } from "./groups";
import { requiresSession } from "./route-contract";

const groupEventProposalListErrors = {
  "401": jsonErrorResponse("An authenticated user is required."),
  "403": jsonErrorResponse("The user lacks proposal access for this event."),
  "404": jsonErrorResponse("The proposal program is not available through this group and event."),
};

export const groupEventProposalsListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List proposals for one group-owned event",
  description:
    "Filtering, full-text search, sort order, aggregates, and pagination are executed in D1. Generic event sharing does not grant proposal access.",
  request: {
    params: groupReferenceParamsSchema.extend({ eventId: eventIdSchema }),
    query: eventProposalsListQuerySchema,
  },
  responses: {
    "200": {
      description: "A bounded proposal page and server-computed review statistics.",
      content: { "application/json": { schema: eventProposalsResponseSchema } },
    },
    ...groupEventProposalListErrors,
  },
};
