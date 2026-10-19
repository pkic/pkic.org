import {
  liveProgramReadRouteSchema,
  liveProgramSelectResultSchema,
  liveProgramSelectRouteSchema,
} from "../../../../../../assets/shared/schemas/live-room-program";
import { markResponseSensitive, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { AppError } from "../../../../../_lib/errors";
import { liveProgramName } from "../../../../../_lib/services/live-session/room-program";
import { readPublishedProgramRoom } from "../../../../../_lib/services/live-session/program-room";
import { resolveUserSessionContext } from "../../../../../_lib/auth/user-session";
import { requireEventPermission } from "../authorization";
export const LiveProgramGet = openApiRoute(liveProgramReadRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
  await readPublishedProgramRoom(db, event.id, data.params.roomId);
  if (!c.env.LIVE_SESSION_ROOMS) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live rooms are not available.");
  return json(
    await c.env.LIVE_SESSION_ROOMS.getByName(liveProgramName(event.id, data.params.roomId)).readProgram(
      event.id,
      data.params.roomId,
    ),
  );
});
export const LiveProgramPost = openApiRoute(liveProgramSelectRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { event, db } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
  if (!c.env.LIVE_SESSION_ROOMS) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live rooms are not available.");
  const { claims } = await resolveUserSessionContext(db, c.req.raw, c.env);
  const result = liveProgramSelectResultSchema.parse(
    await c.env.LIVE_SESSION_ROOMS.getByName(liveProgramName(event.id, data.params.roomId)).selectProgram(
      event.id,
      data.params.roomId,
      data.body,
      claims,
    ),
  );
  if (!result.ok) throw new AppError(result.status, result.code, result.message);
  return json(result.selection);
});
