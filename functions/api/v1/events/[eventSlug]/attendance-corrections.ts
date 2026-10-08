import {
  attendanceEvidenceRouteSchema,
  attendanceCorrectionHistoryRouteSchema,
  attendanceCorrectionCreateRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-attendance-corrections";
import {
  attendanceEvidence,
  attendanceCorrectionHistory,
  correctAttendance,
} from "../../../../_lib/services/event-participation/attendance-corrections";
import { requireEventPermission } from "./authorization";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
export const AttendanceEvidenceGet = openApiRoute(attendanceEvidenceRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return json(await attendanceEvidence(db, event.id, data.query));
});
export const AttendanceCorrectionHistoryGet = openApiRoute(
  attendanceCorrectionHistoryRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
    return json(await attendanceCorrectionHistory(db, event.id, data.params.observationId, data.query));
  },
);
export const AttendanceCorrectionCreate = openApiRoute(
  attendanceCorrectionCreateRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor, context } = await requireEventPermission(
      c,
      data.params.eventSlug,
      "agenda:attendance_correct",
    );
    return json(
      await correctAttendance(
        guardPermissionDatabase(
          db,
          actor,
          [{ permission: "agenda:attendance_correct", context }],
          () => new AppError(403, "ATTENDANCE_CORRECTION_PERMISSION_CHANGED", "Your correction permission changed."),
        ),
        event.id,
        data.params.observationId,
        actor.id,
        data.body,
      ),
    );
  },
);
