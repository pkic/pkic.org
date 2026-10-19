import {
  attendanceCheckInCreateRouteSchema,
  attendanceCheckOutCreateRouteSchema,
  attendanceOccupancyRouteSchema,
  attendancePointExportRouteSchema,
  attendancePointIssuanceRouteSchema,
  attendancePointReadRouteSchema,
  attendancePointsRouteSchema,
  currentAttendanceRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-attendance-points";
import { hasPermission } from "../../../../_lib/auth/permissions";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { currentAttendance } from "../../../../_lib/services/event-attendance-points/current-attendance";
import { attendanceOccupancy } from "../../../../_lib/services/event-attendance-points/occupancy";
import { listAttendancePoints } from "../../../../_lib/services/event-attendance-points/point-catalog";
import { exportAttendancePoints } from "../../../../_lib/services/event-attendance-points/point-exports";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import {
  attendancePointSigningSecret,
  reissueAttendancePointKey,
} from "../../../../_lib/services/event-attendance-points/point-keys";
import {
  readAttendancePoint,
  recordAttendancePoint,
} from "../../../../_lib/services/event-attendance-points/self-check-in";
import { getEventBySlug } from "../../../../_lib/services/events";
import { requireEventPermission } from "./authorization";

/** The signed-in attendee and the event; a check-in only ever acts for the caller. */
async function attendeeContext(c: AdminContext, eventSlug: string) {
  markResponseSensitive(c);
  const db = requestDb(c);
  const attendee = await requireIdentityFromRequest(db, c.req.raw, c.env);
  return { db, userId: attendee.userId, event: await getEventBySlug(db, eventSlug) };
}

export const AttendancePointsGet = openApiRoute(attendancePointsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, context } = await requireEventPermission(
    c,
    data.params.eventSlug,
    "agenda:attendance_read",
  );
  const canReissue = hasPermission(actor, "agenda:write", context);
  return json(await listAttendancePoints(db, attendancePointSigningSecret(c.env), event, data.query, canReissue));
});

export const AttendancePointsExportGet = openApiRoute(
  attendancePointExportRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
    return exportAttendancePoints(
      db,
      attendancePointSigningSecret(c.env),
      event,
      data.query,
      resolveAppBaseUrl(c.env, c.req.raw),
    );
  },
);

export const AttendancePointIssuanceCreate = openApiRoute(
  attendancePointIssuanceRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
    return json(await reissueAttendancePointKey(db, event.id, actor.id), 201);
  },
);

export const AttendancePointGet = openApiRoute(attendancePointReadRouteSchema, async (c: AdminContext, data) => {
  const { db, userId, event } = await attendeeContext(c, data.params.eventSlug);
  return json(
    await readAttendancePoint(db, attendancePointSigningSecret(c.env), event, userId, data.params.pointToken),
  );
});

export const AttendanceCheckInCreate = openApiRoute(
  attendanceCheckInCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, userId, event } = await attendeeContext(c, data.params.eventSlug);
    return json(
      await recordAttendancePoint(db, attendancePointSigningSecret(c.env), event, userId, "check_in", data.body),
    );
  },
);

export const AttendanceCheckOutCreate = openApiRoute(
  attendanceCheckOutCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, userId, event } = await attendeeContext(c, data.params.eventSlug);
    return json(
      await recordAttendancePoint(db, attendancePointSigningSecret(c.env), event, userId, "check_out", data.body),
    );
  },
);

export const CurrentAttendanceGet = openApiRoute(currentAttendanceRouteSchema, async (c: AdminContext, data) => {
  const { db, userId, event } = await attendeeContext(c, data.params.eventSlug);
  return json(await currentAttendance(db, event, userId));
});

export const AttendanceOccupancyGet = openApiRoute(attendanceOccupancyRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return json(await attendanceOccupancy(db, event, data.query));
});
