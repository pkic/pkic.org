import {
  liveRoomOutputsGetRouteSchema,
  liveRoomOutputsPutRouteSchema,
} from "../../../../../../assets/shared/schemas/live-room-output-setup";
import { markResponseSensitive, type AdminContext } from "../../../../../_lib/db/context";
import { jsonNoStore } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { readLiveRoomOutputs, saveLiveRoomOutputs } from "../../../../../_lib/services/live-session/room-output-setup";
import { requireEventPermission } from "../authorization";

/** The outputs a physical room sets up beside Program. */
export const LiveRoomOutputsGet = openApiRoute(liveRoomOutputsGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_studio");
  return jsonNoStore(await readLiveRoomOutputs(db, event.id, data.params.roomId));
});

export const LiveRoomOutputsPut = openApiRoute(liveRoomOutputsPutRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_studio");
  return jsonNoStore(await saveLiveRoomOutputs(db, { event, actor, roomId: data.params.roomId, request: data.body }));
});
