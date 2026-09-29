import { currentUserMeetingSeriesListResponseSchema } from "../../../../../../assets/shared/schemas/member-meetings";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserMeetingSeriesListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-meetings";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listUpcomingMeetingSeriesForMember } from "../../../../../_lib/services/event-series";
import { nowIso } from "../../../../../_lib/utils/time";

export const CurrentUserMeetingSeriesGet = openApiRoute(
  currentUserMeetingSeriesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const from = data.query.from ?? nowIso();
    const result = await listUpcomingMeetingSeriesForMember(db, member.userId, { ...data.query, from });
    return json(
      currentUserMeetingSeriesListResponseSchema.parse({
        series: result.series,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.series.length),
      }),
    );
  },
);
