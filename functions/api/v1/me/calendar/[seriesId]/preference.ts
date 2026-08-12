/**
 * PATCH /api/v1/me/calendar/:seriesId/preference — set or clear my
 * time-slot preference for a meeting series. `icsFileId: null`
 * clears the preference (receive all active variants on the next resend).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { setMyMeetingPreference } from "../../../../../_lib/services/meeting-calendar";
import {
  myCalendarPreferenceSetSchema,
  myCalendarPreferenceRouteSchema,
} from "../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, myCalendarPreferenceSetSchema);
  await setMyMeetingPreference(db, member, c.req.param("seriesId"), body.icsFileId);
  return json({ success: true });
}

export class MeCalendarPreferencePatch extends OpenAPIRoute {
  schema = myCalendarPreferenceRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
