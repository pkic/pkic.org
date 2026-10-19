import {
  locationLiveStreamGetRouteSchema,
  locationLiveStreamPutRouteSchema,
  virtualRoomGetRouteSchema,
} from "../../../../../../assets/shared/schemas/event-live-stream";
import { createUserBackedAuthAdmin } from "../../../../../_lib/auth/admin-identity";
import { computeGrantsForUser, hasPermission } from "../../../../../_lib/auth/permissions";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  readLocationLiveStream,
  replaceLocationLiveStream,
} from "../../../../../_lib/services/event-agenda/location-live-streams";
import { readVirtualRoom } from "../../../../../_lib/services/event-participation/virtual-room";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { authorize } from "./index";

export const LocationLiveStreamGet = openApiRoute(locationLiveStreamGetRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await readLocationLiveStream(db, event, data.params.roomId));
});

export const LocationLiveStreamPut = openApiRoute(locationLiveStreamPutRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await replaceLocationLiveStream(db, event, data.params.roomId, data.body, actor.id));
});

/** Any signed-in person may ask; the use case releases streams only to registered attendees and event staff. */
export const VirtualRoomGet = openApiRoute(virtualRoomGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  const actor = createUserBackedAuthAdmin({
    id: identity.userId,
    email: identity.email,
    sessionId: identity.sessionId,
    grants: await computeGrantsForUser(db, identity.userId),
  });
  const staff = hasPermission(actor, "agenda:read", { type: "event", id: event.id });
  return json(await readVirtualRoom(db, event, { userId: identity.userId, sessionId: identity.sessionId, staff }));
});
