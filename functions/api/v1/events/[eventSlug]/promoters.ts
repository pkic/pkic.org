import { eventPromotersListResponseSchema } from "../../../../../assets/shared/schemas/event-promoters";
import { eventPromotersListRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listEventPromotionActivity } from "../../../../_lib/services/events/promoters";
import { requireEventPermission } from "./authorization";

export const EventPromotersList = openApiRoute(eventPromotersListRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
  return json(eventPromotersListResponseSchema.parse(await listEventPromotionActivity(db, event, data.query)));
});
