import {
  eventAttendanceResponseSchema,
  eventOccurrenceAttendanceVerifyRouteSchema,
} from "../../../../../../../../../../../assets/shared/schemas/event-series";
import { requireAdminFromRequest } from "../../../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../../_lib/openapi/route";
import { verifyOccurrenceAttendance } from "../../../../../../../../../../_lib/services/event-series";

export const GroupMeetingAttendanceVerify = openApiRoute(
  eventOccurrenceAttendanceVerifyRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const confirmation = await verifyOccurrenceAttendance(
      db,
      actor,
      data.params.groupId,
      data.params.seriesId,
      data.params.occurrenceId,
      data.params.confirmationId,
      data.body,
    );
    return json(eventAttendanceResponseSchema.parse({ confirmation }));
  },
);
