import {
  attendanceSummaryRouteSchema,
  attendanceAttemptsRouteSchema,
  attendanceReasonsRouteSchema,
  eventAttendancePeopleRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-attendance-reporting";
import { eventAttendanceSummary } from "../../../../_lib/services/event-participation/attendance-summary";
import {
  eventAttendanceAttempts,
  eventAttendanceReasons,
} from "../../../../_lib/services/event-participation/attendance-attempt-report";
import { eventAttendancePeople } from "../../../../_lib/services/event-participation/attendance-people-report";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { jsonNoStore } from "../../../../_lib/http";
import { requireEventPermission } from "./authorization";
export const AttendanceSummaryGet = openApiRoute(attendanceSummaryRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return jsonNoStore(await eventAttendanceSummary(db, event.id, data.query));
});
export const AttendanceAttemptsGet = openApiRoute(attendanceAttemptsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return jsonNoStore(await eventAttendanceAttempts(db, event.id, data.query));
});
export const AttendanceReasonsGet = openApiRoute(attendanceReasonsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return jsonNoStore(await eventAttendanceReasons(db, event.id, data.query));
});
export const EventAttendancePeopleGet = openApiRoute(
  eventAttendancePeopleRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
    return jsonNoStore(await eventAttendancePeople(db, event.id, data.query));
  },
);
