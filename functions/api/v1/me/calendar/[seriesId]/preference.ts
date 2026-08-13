/**
 * PATCH /api/v1/me/calendar/:seriesId/preference — set or clear my
 * time-slot preference for a meeting series. `icsFileId: null`
 * clears the preference (receive all active variants on the next resend).
 */
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { setMyMeetingPreference } from "../../../../../_lib/services/meeting-calendar";
import { myCalendarPreferenceRouteSchema } from "../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const MeCalendarPreferencePatch = openApiRoute(
  myCalendarPreferenceRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    await setMyMeetingPreference(db, member, data.params.seriesId, data.body.icsFileId);
    return json({ success: true });
  },
);
