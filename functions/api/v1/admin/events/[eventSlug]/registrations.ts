import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listEventRegistrations } from "../../../../../_lib/services/registrations/event-registrations";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import {
  eventRegistrationsListResponseSchema,
  eventRegistrationsQuerySchema,
} from "../../../../../../assets/shared/schemas/event-registrations";
import { eventSlugParamsSchema } from "../../../../../../assets/shared/schemas/api-common";

export const AdminEventRegistrationsGet = openApiRoute(
  {
    tags: ["Admin Registrations"],
    summary: "List an event's registrations",
    request: {
      params: eventSlugParamsSchema,
      query: eventRegistrationsQuerySchema,
    },
    responses: {
      "200": {
        description: "Registrations, event-wide stats, and pagination info.",
        content: { "application/json": { schema: eventRegistrationsListResponseSchema } },
      },
      "401": { description: "Missing or invalid authentication." },
      "404": { description: "Event not found." },
    },
  },
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    await requireAdminFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, data.params.eventSlug);

    const result = await listEventRegistrations(db, event.id, data.query);
    return json(
      eventRegistrationsListResponseSchema.parse({
        event: { id: event.id, slug: event.slug, name: event.name },
        registrations: result.registrations,
        stats: result.stats,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.registrations.length),
      }),
    );
  },
);
