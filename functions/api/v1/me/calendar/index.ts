/**
 * GET /api/v1/me/calendar — meeting series I'm subscribed to, with my
 * time-slot preferences (PRD §4.12).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyMeetingSeries } from "../../../../_lib/services/meeting-calendar";
import { myCalendarListRouteSchema } from "../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const meetingSeries = await listMyMeetingSeries(db, member);
  return json({ meetingSeries });
}

export class MeCalendarGet extends OpenAPIRoute {
  schema = myCalendarListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
