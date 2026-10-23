import { eventDetailResponseSchema } from "../../../../../assets/shared/schemas/event-management";
import { eventDetailRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { prepareOptionalUserSessionRequest } from "../../../../_lib/auth/user-session-request";
import { readEventDetailPage } from "../../../../_lib/services/events/detail-page";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const EventDetailGet = openApiRoute(eventDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const auth = await prepareOptionalUserSessionRequest(db, c.req.raw, c.env);
  return json(eventDetailResponseSchema.parse({ event: await readEventDetailPage(db, data.params.eventSlug, auth) }));
});
