/** Event-specific sponsorship attendee-data entitlements. */
import {
  eventSponsorTiersGetRouteSchema,
  eventSponsorTiersPutRouteSchema,
  eventSponsorTiersResponseSchema,
} from "../../../../../../assets/shared/schemas/sponsorship-management";
import { guardPermissionMutationDatabase } from "../../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listEventSponsorTiers, replaceEventSponsorTiers } from "../../../../../_lib/services/sponsorship";
import { requireEventPermission } from "../authorization";

export const EventSponsorTiersGet = openApiRoute(eventSponsorTiersGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
  return json(eventSponsorTiersResponseSchema.parse({ tiers: await listEventSponsorTiers(db, event.id) }));
});

export const EventSponsorTiersPut = openApiRoute(eventSponsorTiersPutRouteSchema, async (c: AdminContext, data) => {
  const { actor: staff, context, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const guardedDb = guardPermissionMutationDatabase(
    db,
    staff,
    [{ permission: "events:write", context }],
    () =>
      new AppError(
        409,
        "EVENT_SPONSOR_TIER_AUTHORIZATION_CHANGED",
        "Event-management permission changed while sponsor tier access was being saved",
      ),
  );

  await replaceEventSponsorTiers(guardedDb, staff.id, event.id, data.body.tiers);
  return json(eventSponsorTiersResponseSchema.parse({ tiers: await listEventSponsorTiers(db, event.id) }));
});
