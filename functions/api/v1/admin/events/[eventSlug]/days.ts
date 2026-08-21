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
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listAdminEventDaysWithCounts } from "../../../../../_lib/services/event-days";
import { replaceConfiguredEventDays } from "../../../../../_lib/services/events/day-configuration";
import { adminEventDaysReplaceSchema } from "../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const days = await listAdminEventDaysWithCounts(requestDb(c), event.id);
  return json({ days });
}

export async function onRequestPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventDaysReplaceSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  const { skipped } = await replaceConfiguredEventDays(requestDb(c), admin.id, event, body);

  const updatedDays = await listAdminEventDaysWithCounts(requestDb(c), event.id);
  return json({ success: true, days: updatedDays, skipped });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
