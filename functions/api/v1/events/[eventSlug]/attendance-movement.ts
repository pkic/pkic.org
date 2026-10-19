import {
  attendanceAttributionsRouteSchema,
  attendanceMovementsRouteSchema,
  selfCheckInsRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-attendance-points";
import { markResponseSensitive } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listSelfCheckIns } from "../../../../_lib/services/event-attendance-points/self-check-in-records";
import {
  attendanceAttributions,
  attendanceMovements,
} from "../../../../_lib/services/event-attendance-points/session-attribution";
import { requireEventPermission } from "./authorization";

export const SelfCheckInsGet = openApiRoute(selfCheckInsRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return json(await listSelfCheckIns(db, event, data.query));
});

export const AttendanceAttributionsGet = openApiRoute(attendanceAttributionsRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return json(await attendanceAttributions(db, event, data.query));
});

export const AttendanceMovementsGet = openApiRoute(attendanceMovementsRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return json(await attendanceMovements(db, event, data.query));
});
