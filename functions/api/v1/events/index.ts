import { eventsListResponseSchema } from "../../../../assets/shared/schemas/event-management";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { eventsListRouteSchema } from "../../../../assets/shared/schemas/route-contracts-events";
import { resolveUserSessionFromRequest, getUserSessionToken } from "../../../_lib/auth/user-session";
import { hasPermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listManagedEvents, listVisibleEvents } from "../../../_lib/services/events/catalog";
import { eventAudienceViewer } from "../../../_lib/services/events/visibility";

export const EventsListGet = openApiRoute(eventsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const session = getUserSessionToken(c.req.raw)
    ? await resolveUserSessionFromRequest(db, c.req.raw, {
        INTERNAL_SIGNING_SECRET: c.env.INTERNAL_SIGNING_SECRET,
      })
    : null;
  const viewer = eventAudienceViewer(session);
  // A per-event contextual grant must not unlock a management listing of every
  // event, so the management projection requires a global events:read.
  const managed = session?.staff ? hasPermission(session.staff, "events:read") : false;
  const result = managed
    ? await listManagedEvents(db, viewer, data.query)
    : await listVisibleEvents(db, viewer, data.query);
  return json(
    eventsListResponseSchema.parse({
      events: result.events,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.events.length),
    }),
  );
});
