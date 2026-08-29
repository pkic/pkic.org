import { eventsListResponseSchema } from "../../../../assets/shared/schemas/event-management";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { eventsListRouteSchema } from "../../../../assets/shared/schemas/route-contracts-events";
import { resolveUserSessionFromRequest, getUserSessionToken } from "../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listVisibleEvents } from "../../../_lib/services/events/catalog";
import { eventAudienceViewer } from "../../../_lib/services/events/visibility";

export const EventsListGet = openApiRoute(eventsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const session = getUserSessionToken(c.req.raw)
    ? await resolveUserSessionFromRequest(db, c.req.raw, {
        INTERNAL_SIGNING_SECRET: c.env.INTERNAL_SIGNING_SECRET,
      })
    : null;
  const result = await listVisibleEvents(db, eventAudienceViewer(session), data.query);
  return json(
    eventsListResponseSchema.parse({
      events: result.events,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.events.length),
    }),
  );
});
