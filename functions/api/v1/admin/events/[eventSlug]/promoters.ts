import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { listEventPromotionActivity } from "../../../../../_lib/services/events/promoters";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  eventPromotersListResponseSchema,
  eventPromotersListRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-event-promoters";

export const AdminEventPromotersGet = openApiRoute(eventPromotersListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
  return json(
    eventPromotersListResponseSchema.parse(await listEventPromotionActivity(requestDb(c), event, data.query)),
  );
});
