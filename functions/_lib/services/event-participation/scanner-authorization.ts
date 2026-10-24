import { scannerPermission, type ScannerCapability } from "../../../../assets/shared/event-scanner-permissions";
import {
  hasPermission,
  requirePermission,
  guardPermissionDatabase,
  type PermissionContext,
} from "../../auth/permissions";
import type { UserBackedAuthAdmin, DatabaseLike } from "../../types";
import type { Permission } from "../../../../assets/shared/schemas/permissions";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import { AppError } from "../../errors";

/** One action-capability policy for scanner routes and prepared resource reads. */
export function requireScannerCapability(
  actor: UserBackedAuthAdmin,
  eventId: string,
  capability: ScannerCapability | readonly ScannerCapability[],
) {
  const context = { type: "event", id: eventId };
  const capabilities = typeof capability === "string" ? [capability] : capability;
  const permission = capabilities
    .map((value) => scannerPermission((candidate) => hasPermission(actor, candidate, context), value))
    .find(Boolean);
  if (!permission) requirePermission(actor, capabilities[0]!, context);
  return { context, permission: permission ?? capabilities[0]! };
}

/** The same operator/action checks and atomic authority guard serve attendance and sponsor captures. */
export function guardScannerUploadAuthority(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  context: PermissionContext,
  actionPermission: Permission,
  scan: EventScanRequest,
) {
  const attendancePermission = scannerPermission(
    (value) => hasPermission(actor, value, context),
    "agenda:attendance_record",
  );
  if (scan.action === "exception" && scan.recordAttendance && !attendancePermission)
    throw new AppError(403, "ATTENDANCE_PERMISSION_REQUIRED", "Attendance recording permission required.");
  if (scan.operatorUserId !== actor.id)
    throw new AppError(403, "SCAN_OPERATOR_CHANGED", "Sign in as the original scanner operator to upload these scans.");
  return {
    db: guardPermissionDatabase(
      db,
      actor,
      [
        { permission: actionPermission, context },
        ...(scan.recordAttendance && attendancePermission ? [{ permission: attendancePermission, context }] : []),
        ...(scan.action === "exception" ? [{ permission: "agenda:admit_exceptions" as const, context }] : []),
      ],
      () => new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again."),
    ),
    canAdmitExceptions: hasPermission(actor, "agenda:admit_exceptions", context),
  };
}
