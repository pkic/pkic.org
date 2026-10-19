import {
  attendanceImportReviewRouteSchema,
  attendanceImportApplyRouteSchema,
  attendanceImportsRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-attendance-imports";
import {
  reviewAttendanceImport,
  applyAttendanceImport,
  attendanceImports,
} from "../../../../_lib/services/event-participation/attendance-imports";
import { requireEventPermission } from "./authorization";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
export const AttendanceImportsGet = openApiRoute(attendanceImportsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return json(await attendanceImports(db, event.id, data.query));
});
export const AttendanceImportReviewCreate = openApiRoute(
  attendanceImportReviewRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor, context } = await requireEventPermission(
      c,
      data.params.eventSlug,
      "agenda:attendance_import",
    );
    const guarded = guardPermissionDatabase(
      db,
      actor,
      [{ permission: "agenda:attendance_import", context }],
      () => new AppError(403, "ATTENDANCE_IMPORT_PERMISSION_CHANGED", "Your attendance import permission changed."),
    );
    return json(await reviewAttendanceImport(guarded, event.id, actor.id, data.body));
  },
);
export const AttendanceImportCreate = openApiRoute(attendanceImportApplyRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, context } = await requireEventPermission(
    c,
    data.params.eventSlug,
    "agenda:attendance_import",
  );
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "agenda:attendance_import", context }],
    () => new AppError(403, "ATTENDANCE_IMPORT_PERMISSION_CHANGED", "Your attendance import permission changed."),
  );
  return json(await applyAttendanceImport(guarded, event.id, actor.id, data.body));
});
