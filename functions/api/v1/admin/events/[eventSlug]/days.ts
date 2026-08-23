/**
 * GET /api/v1/admin/events/:eventSlug/days
 *   Returns all event days with attendance options and registration counts
 *   per day per attendance type.
 *
 * PUT /api/v1/admin/events/:eventSlug/days
 *   Replaces event days. Existing days matched by date are updated in-place.
 *   Days removed from the list are deleted only if they have no registered
 *   attendees; otherwise they are skipped and reported in the response.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listAdminEventDaysWithCounts } from "../../../../../_lib/services/event-days";
import { replaceConfiguredEventDays } from "../../../../../_lib/services/events/day-configuration";
import {
  adminEventDaysReplaceResponseSchema,
  adminEventDaysResponseSchema,
} from "../../../../../../assets/shared/schemas/admin-events";
import {
  adminEventDaysGetRouteSchema,
  adminEventDaysReplaceRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const AdminEventDaysGet = openApiRoute(adminEventDaysGetRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
  const days = await listAdminEventDaysWithCounts(requestDb(c), event.id);
  return json(adminEventDaysResponseSchema.parse({ days }));
});

export const AdminEventDaysReplace = openApiRoute(adminEventDaysReplaceRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);

  const { skipped } = await replaceConfiguredEventDays(requestDb(c), admin.id, event, data.body);

  const updatedDays = await listAdminEventDaysWithCounts(requestDb(c), event.id);
  return json(adminEventDaysReplaceResponseSchema.parse({ success: true, days: updatedDays, skipped }));
});
