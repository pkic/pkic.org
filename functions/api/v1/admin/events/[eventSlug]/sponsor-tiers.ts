/**
 * GET /api/v1/admin/events/:eventSlug/sponsor-tiers
 *   Returns which sponsor tiers get attendee-data-access for this event.
 *
 * PUT /api/v1/admin/events/:eventSlug/sponsor-tiers
 *   Replaces the full tier config. Defaults to no tiers having
 *   access — an empty PUT clears all configured tiers.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listEventSponsorTiers, replaceEventSponsorTiers } from "../../../../../_lib/services/sponsorship";
import {
  eventSponsorTiersGetRouteSchema,
  eventSponsorTiersPutRouteSchema,
  eventSponsorTiersResponseSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const AdminEventsEventSlugSponsorTiersGet = openApiRoute(
  eventSponsorTiersGetRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
    const tiers = await listEventSponsorTiers(requestDb(c), event.id);
    return json(eventSponsorTiersResponseSchema.parse({ tiers }));
  },
);

export const AdminEventsEventSlugSponsorTiersPut = openApiRoute(
  eventSponsorTiersPutRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);

    await replaceEventSponsorTiers(requestDb(c), admin.id, event.id, data.body.tiers);

    const tiers = await listEventSponsorTiers(requestDb(c), event.id);
    return json(eventSponsorTiersResponseSchema.parse({ tiers }));
  },
);
