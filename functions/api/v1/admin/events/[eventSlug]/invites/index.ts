import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { listAdminEventInvites } from "../../../../../../_lib/services/events/admin-invite-list";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  adminEventInvitesListQuerySchema,
  adminEventInvitesListResponseSchema,
} from "../../../../../../../assets/shared/schemas/admin-events";
import { eventSlugParamsSchema } from "../../../../../../../assets/shared/schemas/api-common";

const adminEventInvitesListRouteSchema = {
  tags: ["Admin events"],
  summary: "List invites for an event (admin)",
  description: "Paginated, optionally status/type-filtered list of invites for an event.",
  request: { params: eventSlugParamsSchema, query: adminEventInvitesListQuerySchema },
  responses: {
    "200": {
      description: "Invites list.",
      content: { "application/json": { schema: adminEventInvitesListResponseSchema } },
    },
  },
};

/**
 * GET /api/v1/admin/events/:eventSlug/invites
 *
 * Returns a bounded page of invites for an event, with optional status filter.
 * Query params:
 *   ?status=sent|accepted|declined|expired|revoked   (omit for all)
 *   ?type=attendee|speaker                            (omit for all)
 */
export const AdminEventInvitesList = openApiRoute(adminEventInvitesListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  return json(await listAdminEventInvites(requestDb(c), event.id, data.query));
});
