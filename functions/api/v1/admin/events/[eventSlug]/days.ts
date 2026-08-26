/**
 * GET /api/v1/admin/events/:eventSlug/days
 *   Returns all event days with attendance options and registration counts
 *   per day per attendance type.
 *
 * This compatibility read remains for registration and form views. Event-day
 * mutations now belong exclusively to the selected-group portal.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listConfiguredEventDaysWithCounts } from "../../../../../_lib/services/event-days";
import { eventDaysResponseSchema } from "../../../../../../assets/shared/schemas/event-configuration";
import { adminEventDaysGetRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const AdminEventDaysGet = openApiRoute(adminEventDaysGetRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
  const days = await listConfiguredEventDaysWithCounts(requestDb(c), event.id);
  return json(eventDaysResponseSchema.parse({ days }));
});
