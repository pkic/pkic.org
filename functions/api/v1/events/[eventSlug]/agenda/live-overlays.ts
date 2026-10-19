import { liveOverlayAccessRouteSchema } from "../../../../../../assets/shared/schemas/live-session-room";
import { markResponseSensitive, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { issueLiveOverlayAccess } from "../../../../../_lib/services/live-session/overlay-access";
import { requireEventPermission } from "../authorization";

/** A room operator issues a read-only overlay access for broadcast browser sources. */
export const LiveOverlayAccessPost = openApiRoute(liveOverlayAccessRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
  return json(await issueLiveOverlayAccess(db, c.env, event.id, data.params.roomId, actor.id), 201);
});
