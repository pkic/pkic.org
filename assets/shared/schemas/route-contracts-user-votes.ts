import { currentUserVotesListResponseSchema, votesListQuerySchema } from "./votes";
import { requiresSession } from "./route-contract";

export const currentUserVotesListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Votes"],
  summary: "List votes visible to the current user across every group",
  description:
    "The cross-group self-participation projection over `listVisibleVotesForMember`: public votes plus every vote reachable through the caller's active group memberships. Filtering, sorting, counting, and pagination run in D1.",
  request: { query: votesListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of votes visible to the current user.",
      content: { "application/json": { schema: currentUserVotesListResponseSchema } },
    },
    "401": { description: "A signed-in session is required." },
    "403": { description: "The signed-in user has no active membership." },
  },
};
