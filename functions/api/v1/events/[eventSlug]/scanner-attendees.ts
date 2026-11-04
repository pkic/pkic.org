import {
  scannerAttendeesRouteSchema,
  scannerAttendeeBadgeRouteSchema,
} from "../../../../../assets/shared/schemas/event-scanner-lookup";
import { markResponseSensitive } from "../../../../_lib/db/context";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { badgeAttendees } from "../../../../_lib/services/event-participation/badge-attendees";
import { scannerAttendeeBadge } from "../../../../_lib/services/event-participation/scanner-attendee-badge";
import { requireEventScannerPermission } from "./authorization";

export const ScannerAttendeesGet = openApiRoute(scannerAttendeesRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventScannerPermission(c, data.params.eventSlug, [
    "agenda:check",
    "agenda:admit",
    "agenda:attendance_record",
  ]);
  return json(await badgeAttendees(db, event.id, data.query));
});

export const ScannerAttendeeBadgeGet = openApiRoute(scannerAttendeeBadgeRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  const { db, actor, context, permission, event } = await requireEventScannerPermission(c, data.params.eventSlug, [
    "agenda:check",
    "agenda:admit",
    "agenda:attendance_record",
  ]);
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission, context }],
    () => new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again."),
  );
  return json(await scannerAttendeeBadge(guarded, c.env, event.id, data.params.userId));
});
