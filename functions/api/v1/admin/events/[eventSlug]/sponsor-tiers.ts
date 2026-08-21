/**
 * GET /api/v1/admin/events/:eventSlug/sponsor-tiers
 *   Returns which sponsor tiers get attendee-data-access for this event.
 *
 * PUT /api/v1/admin/events/:eventSlug/sponsor-tiers
 *   Replaces the full tier config. Defaults to no tiers having
 *   access — an empty PUT clears all configured tiers.
 */
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listEventSponsorTiers, replaceEventSponsorTiers } from "../../../../../_lib/services/sponsorship";
import { parseJsonBody } from "../../../../../_lib/validation";
import { eventSponsorTiersReplaceSchema } from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const tiers = await listEventSponsorTiers(requestDb(c), event.id);
  return json({ tiers });
}

export async function onRequestPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, eventSponsorTiersReplaceSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  await replaceEventSponsorTiers(requestDb(c), admin.id, event.id, body.tiers);

  const tiers = await listEventSponsorTiers(requestDb(c), event.id);
  return json({ tiers });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet, PUT: onRequestPut });
}
