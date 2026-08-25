import { eventSeriesCalendarRouteSchema } from "../../../../../../../../assets/shared/schemas/event-series";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { generateGroupSeriesIcs } from "../../../../../../../_lib/services/event-series";
import { requireGroupResourceContext } from "../../../../group-resource-context";

export const GroupMeetingSeriesCalendar = openApiRoute(
  eventSeriesCalendarRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const calendar = await generateGroupSeriesIcs(
      db,
      viewer,
      group,
      data.params.seriesId,
      new URL(c.req.raw.url).origin,
    );
    return new Response(calendar, {
      headers: {
        "content-type": "text/calendar; charset=UTF-8",
        "content-disposition": `attachment; filename="${data.params.seriesId}.ics"`,
      },
    });
  },
);
