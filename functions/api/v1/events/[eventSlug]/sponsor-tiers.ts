/**
 * Event-specific sponsorship attendee-data entitlements. This is separate
 * from the global sponsorship pricing catalog and remains owned by event
 * management.
 */
import {
  eventSponsorTiersGetRouteSchema,
  eventSponsorTiersPutRouteSchema,
  eventSponsorTiersResponseSchema,
} from "../../../../../assets/shared/schemas/sponsorship-management";
import type { Permission } from "../../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { guardPermissionMutationDatabase, requirePermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventBySlug } from "../../../../_lib/services/events";
import { listEventSponsorTiers, replaceEventSponsorTiers } from "../../../../_lib/services/sponsorship";

async function requireEventSponsorTierPermission(c: AdminContext, eventSlug: string, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, eventSlug);
  const context = { type: "event", id: event.id };
  requirePermission(staff, permission, context);
  return { context, db, event, staff };
}

export const EventSponsorTiersGet = openApiRoute(eventSponsorTiersGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventSponsorTierPermission(c, data.params.eventSlug, "events:read");
  return json(eventSponsorTiersResponseSchema.parse({ tiers: await listEventSponsorTiers(db, event.id) }));
});

export const EventSponsorTiersPut = openApiRoute(eventSponsorTiersPutRouteSchema, async (c: AdminContext, data) => {
  const { context, db, event, staff } = await requireEventSponsorTierPermission(
    c,
    data.params.eventSlug,
    "events:write",
  );
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
