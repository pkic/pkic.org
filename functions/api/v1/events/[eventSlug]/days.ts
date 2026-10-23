import {
  eventDaysManagementReplaceResponseSchema,
  eventDaysManagementResponseSchema,
} from "../../../../../assets/shared/schemas/event-configuration";
import {
  eventDaysGetRouteSchema,
  eventDaysPutRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-events";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getDirectEventDays, replaceDirectEventDays } from "../../../../_lib/services/events/direct-days";
import { requireEventPermission } from "./authorization";

export const EventDaysGet = openApiRoute(eventDaysGetRouteSchema, async (c: AdminContext, data) => {
  return json(
    eventDaysManagementResponseSchema.parse(
      await getDirectEventDays(requestDb(c), c.req.raw, c.env, data.params.eventSlug),
    ),
  );
});

export const EventDaysPut = openApiRoute(eventDaysPutRouteSchema, async (c: AdminContext, data) => {
  const { actor, db } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const result = await replaceDirectEventDays(db, actor, data.params.eventSlug, data.body);
  return json(eventDaysManagementReplaceResponseSchema.parse({ success: true, ...result }));
});
