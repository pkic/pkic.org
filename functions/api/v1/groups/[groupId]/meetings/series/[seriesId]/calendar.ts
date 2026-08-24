import { eventSeriesCalendarRouteSchema } from "../../../../../../../../assets/shared/schemas/event-series";
import { resolveOptionalGroupViewer } from "../../../../../../../_lib/auth/group-access";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { AppError } from "../../../../../../../_lib/errors";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { generateGroupSeriesIcs } from "../../../../../../../_lib/services/event-series";
import { getVisibleGroup } from "../../../../../../../_lib/services/groups";

export const GroupMeetingSeriesCalendar = openApiRoute(
  eventSeriesCalendarRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const viewer = await resolveOptionalGroupViewer(db, c.req.raw, c.env);
    const group = await getVisibleGroup(db, data.params.groupId, {
      userId: viewer.userId,
      canReadAll: viewer.canReadAll,
    });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
    const calendar = await generateGroupSeriesIcs(db, group.id, data.params.seriesId, new URL(c.req.raw.url).origin);
    return new Response(calendar, {
      headers: {
        "content-type": "text/calendar; charset=UTF-8",
        "content-disposition": `attachment; filename="${data.params.seriesId}.ics"`,
      },
    });
  },
);
