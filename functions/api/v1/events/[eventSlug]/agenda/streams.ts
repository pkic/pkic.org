import {
  locationLiveStreamGetRouteSchema,
  locationLiveStreamPutRouteSchema,
  virtualRoomGetRouteSchema,
} from "../../../../../../assets/shared/schemas/event-live-stream";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  readLocationLiveStreamRequest,
  replaceLocationLiveStream,
} from "../../../../../_lib/services/event-agenda/location-live-streams";
import { readVirtualRoomRequest } from "../../../../../_lib/services/event-participation/virtual-room";
import { authorize } from "./index";

export const LocationLiveStreamGet = openApiRoute(locationLiveStreamGetRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  return json(
    await readLocationLiveStreamRequest(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.params.roomId),
  );
});

export const LocationLiveStreamPut = openApiRoute(locationLiveStreamPutRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await replaceLocationLiveStream(db, event, data.params.roomId, data.body, actor.id));
});

/** Any signed-in person may ask; the use case releases streams only to registered attendees and event staff. */
export const VirtualRoomGet = openApiRoute(virtualRoomGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await readVirtualRoomRequest(requestDb(c), c.req.raw, c.env, data.params.eventSlug));
});
