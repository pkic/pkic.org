/**
 * GET /api/v1/me/calendar — meeting series I'm subscribed to, with my
 * time-slot preferences.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyMeetingSeries } from "../../../../_lib/services/meeting-calendar";
import { myCalendarListRouteSchema } from "../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeCalendarGet = openApiRoute(myCalendarListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const result = await listMyMeetingSeries(db, member, data.query);
  return json(result);
});
