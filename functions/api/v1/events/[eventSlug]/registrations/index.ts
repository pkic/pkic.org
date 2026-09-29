import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listEventRegistrations } from "../../../../../_lib/services/registrations/event-registrations";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { eventRegistrationsListResponseSchema } from "../../../../../../assets/shared/schemas/event-registrations";
import { eventRegistrationsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { requireEventRegistrationManagement } from "./authorization";

export const EventRegistrationsListGet = openApiRoute(
  eventRegistrationsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
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
