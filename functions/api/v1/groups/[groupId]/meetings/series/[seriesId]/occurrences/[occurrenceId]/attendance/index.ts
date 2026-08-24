import {
  eventAttendanceListResponseSchema,
  eventOccurrenceAttendanceListRouteSchema,
} from "../../../../../../../../../../../assets/shared/schemas/event-series";
import { buildPageInfo } from "../../../../../../../../../../../assets/shared/schemas/pagination";
import { requireAdminFromRequest } from "../../../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../../_lib/openapi/route";
import { listOccurrenceAttendance } from "../../../../../../../../../../_lib/services/event-series";

export const GroupMeetingAttendanceList = openApiRoute(
  eventOccurrenceAttendanceListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const { confirmations, total } = await listOccurrenceAttendance(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.query,
    );
    return json(
      eventAttendanceListResponseSchema.parse({
        confirmations,
        page: buildPageInfo(data.query.limit, data.query.offset, total, confirmations.length),
      }),
    );
  },
);
