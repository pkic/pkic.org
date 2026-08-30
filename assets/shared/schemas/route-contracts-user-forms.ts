import { currentUserFormsListQuerySchema, currentUserFormsListResponseSchema } from "./member-forms";
import { requiresSession } from "./route-contract";

export const currentUserFormsListRouteSchema = {
  ...requiresSession(),
  tags: ["Users", "Forms"],
  summary: "List open form placements the current user may submit across every group",
  description:
    "Active, currently accepting placements owned by a group the caller belongs to, plus placements shared with one of the caller's groups through a form_placement_group_grants submit grant — the same predicates the per-group GET /groups/:groupId/forms read model applies. Bounded, sorted by closing time ascending (open-ended placements last), and evaluated in one set-based D1 query.",
  request: { query: currentUserFormsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of open form placements the current user may submit.",
      content: { "application/json": { schema: currentUserFormsListResponseSchema } },
    },
    "401": { description: "A signed-in session is required." },
    "403": { description: "The signed-in user has no active membership." },
  },
};
