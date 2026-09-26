import {
  groupEventSponsorTiersGetRouteSchema,
  groupEventSponsorTiersPutRouteSchema,
} from "../../../../../../../../assets/shared/schemas/group-events";
import { eventSponsorTiersResponseSchema } from "../../../../../../../../assets/shared/schemas/sponsorship-management";
import type { AdminContext } from "../../../../../../../_lib/db/context";
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { listEventSponsorTiers, replaceEventSponsorTiers } from "../../../../../../../_lib/services/sponsorship";
import { requireManagedGroupEventContext } from "../management-context";

export const GroupEventSponsorTiersGet = openApiRoute(
  groupEventSponsorTiersGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireManagedGroupEventContext(c, data.params.groupId, data.params.eventId);
    return json(eventSponsorTiersResponseSchema.parse({ tiers: await listEventSponsorTiers(db, event.id) }));
  },
);

export const GroupEventSponsorTiersPut = openApiRoute(
  groupEventSponsorTiersPutRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireManagedGroupEventContext(c, data.params.groupId, data.params.eventId);
    await replaceEventSponsorTiers(db, actor.id, event.id, data.body.tiers);
    return json(eventSponsorTiersResponseSchema.parse({ tiers: await listEventSponsorTiers(db, event.id) }));
  },
);
