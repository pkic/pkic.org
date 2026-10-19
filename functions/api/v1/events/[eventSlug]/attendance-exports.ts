import {
  attendancePeopleExportRouteSchema,
  attendanceAttemptsExportRouteSchema,
  attendanceSummaryExportRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-attendance-exports";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { markResponseSensitive } from "../../../../_lib/db/context";
import { csvResponse } from "../../../../_lib/csv";
import { exportAttendance } from "../../../../_lib/services/event-participation/attendance-export";
import { requireEventPermission } from "./authorization";
export const AttendancePeopleExportGet = openApiRoute(attendancePeopleExportRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  const result = await exportAttendance(db, event.id, actor, "people", data.query);
  return csvResponse(result.csv, `${event.slug}-observed-people.csv`);
});
export const AttendanceAttemptsExportGet = openApiRoute(attendanceAttemptsExportRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  const result = await exportAttendance(db, event.id, actor, "attempts", data.query);
  return csvResponse(result.csv, `${event.slug}-scan-attempts.csv`);
});
export const AttendanceSummaryExportGet = openApiRoute(attendanceSummaryExportRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  const result = await exportAttendance(db, event.id, actor, "summary", data.query);
  return csvResponse(result.csv, `${event.slug}-attendance-summary.csv`);
});
