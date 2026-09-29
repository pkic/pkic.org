import { selfGroupsListQuerySchema, selfGroupsListResponseSchema } from "./group-participation";
import { requiresSession } from "./route-contract";

export const selfGroupsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Groups"],
  summary: "List groups available to the current user",
  description:
    "Eligibility, visibility, search, sorting, counting, and pagination are evaluated in D1. Each group includes all currently eligible Member capacities and the caller's active capacity memberships.",
  request: { query: selfGroupsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded self-service group page.",
      content: { "application/json": { schema: selfGroupsListResponseSchema } },
    },
    "401": { description: "A member session is required." },
  },
};
