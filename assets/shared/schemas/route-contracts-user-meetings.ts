import { currentUserMeetingsListQuerySchema, currentUserMeetingsListResponseSchema } from "./member-meetings";
import { requiresSession } from "./route-contract";

export const currentUserMeetingsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Meetings"],
  summary: "List upcoming meeting occurrences visible to the current user across every group",
  description:
    "Union of every active series' scheduled occurrences reachable through the caller's active group memberships — owner-group membership or an event_group_grants view/register/attend grant to another group. Bounded, sorted by start time ascending, and evaluated in one set-based D1 query.",
  request: { query: currentUserMeetingsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of upcoming meeting occurrences.",
      content: { "application/json": { schema: currentUserMeetingsListResponseSchema } },
    },
    "401": { description: "A signed-in session is required." },
    "403": { description: "The signed-in user has no active membership." },
  },
};
