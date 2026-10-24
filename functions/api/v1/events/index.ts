import { eventsListResponseSchema } from "../../../../assets/shared/schemas/event-management";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { eventsListRouteSchema } from "../../../../assets/shared/schemas/route-contracts-events";
import { prepareOptionalUserSessionRequest } from "../../../_lib/auth/user-session-request";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { readEventsListPage } from "../../../_lib/services/events/list-page";

export const EventsListGet = openApiRoute(eventsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const auth = await prepareOptionalUserSessionRequest(db, c.req.raw, c.env);
  const result = await readEventsListPage(db, data.query, auth);
  return json(
    eventsListResponseSchema.parse({
      events: result.events,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.events.length),
    }),
  );
});
