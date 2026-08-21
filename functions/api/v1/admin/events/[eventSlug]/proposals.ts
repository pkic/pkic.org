import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listAdminEventProposals } from "../../../../../_lib/services/admin-event-proposals";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { adminEventProposalsQuerySchema } from "../../../../../../assets/shared/schemas/admin-events";
import { eventSlugParamsSchema } from "../../../../../../assets/shared/schemas/api-common";
import { adminEventProposalsResponseSchema } from "../../../../../../assets/shared/schemas/admin-event-proposals";

export const AdminEventsEventSlugProposalsGet = openApiRoute(
  {
    tags: ["Admin proposals"],
    summary: "List event proposals",
    request: { params: eventSlugParamsSchema, query: adminEventProposalsQuerySchema },
    responses: {
      "200": {
        description: "Event proposals visible to the authenticated actor.",
        content: { "application/json": { schema: adminEventProposalsResponseSchema } },
      },
      "401": { description: "Missing or invalid authentication." },
      "403": { description: "The actor lacks access to proposals for this event." },
    },
  },
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, c.req.param("eventSlug"));
    requirePermission(admin, "proposals:read", { type: "event", id: event.id });
    const access = await getProposalAccessForEvent(db, event.id, admin);
    const { status, recommendation, sort, q, deleted, limit, offset } = data.query;
    const result = await listAdminEventProposals(db, {
      eventId: event.id,
      status,
      recommendation,
      sort,
      q,
      deleted,
      limit,
      offset,
    });

    return json({
      event: { id: event.id, slug: event.slug, name: event.name },
      access,
      ...result,
    });
  },
);
