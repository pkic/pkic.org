import { currentUserMeetingsListResponseSchema } from "../../../../../../assets/shared/schemas/member-meetings";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserMeetingsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-meetings";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listUpcomingMeetingsForMember } from "../../../../../_lib/services/event-series";
import { nowIso } from "../../../../../_lib/utils/time";

export const CurrentUserMeetingsGet = openApiRoute(
  currentUserMeetingsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    // "now" is resolved once, here, and passed through — the query builder never calls the clock itself.
    const from = data.query.from ?? nowIso();
    const result = await listUpcomingMeetingsForMember(db, member.userId, { ...data.query, from });
    return json(
      currentUserMeetingsListResponseSchema.parse({
        occurrences: result.occurrences,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.occurrences.length),
      }),
    );
  },
);
