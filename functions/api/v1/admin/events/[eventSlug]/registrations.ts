import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listAdminEventRegistrations } from "../../../../../_lib/services/registrations/admin-list";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import {
  adminEventRegistrationsListResponseSchema,
  adminEventRegistrationsQuerySchema,
} from "../../../../../../assets/shared/schemas/admin-events";
import { eventSlugParamsSchema } from "../../../../../../assets/shared/schemas/api-common";

export const AdminEventRegistrationsGet = openApiRoute(
  {
    tags: ["Admin Registrations"],
    summary: "List an event's registrations",
    request: {
      params: eventSlugParamsSchema,
      query: adminEventRegistrationsQuerySchema,
    },
    responses: {
      "200": {
        description: "Registrations, event-wide stats, and pagination info.",
        content: { "application/json": { schema: adminEventRegistrationsListResponseSchema } },
      },
      "401": { description: "Missing or invalid authentication." },
      "404": { description: "Event not found." },
    },
  },
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    await requireAdminFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, c.req.param("eventSlug"));

    const result = await listAdminEventRegistrations(db, event.id, data.query);
    return json(
      adminEventRegistrationsListResponseSchema.parse({
        event: { id: event.id, slug: event.slug, name: event.name },
        registrations: result.registrations,
        stats: result.stats,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.registrations.length),
      }),
    );
  },
);
