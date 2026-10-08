import { scanActionCapability, scannerPermission } from "../../../../../assets/shared/event-scanner-permissions";
import {
  eventScanCreateRouteSchema,
  scannerTargetsRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-scanning";
import { guardPermissionDatabase, hasPermission } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { recordScan } from "../../../../_lib/services/event-participation/scanning";
import { requireSponsorLeadPermission } from "./sponsor-authorization";
import { requireEventScannerPermission } from "./authorization";
import { captureSponsorLead } from "../../../../_lib/services/event-participation/sponsor-leads";
import { scannerTargets } from "../../../../_lib/services/event-participation/reporting";
import { receiveScannerUpload } from "../../../../_lib/services/event-participation/scanner-upload-receipts";
export const ScannerTargetsGet = openApiRoute(scannerTargetsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventScannerPermission(c, data.params.eventSlug, [
    "agenda:check",
    "agenda:admit",
    "agenda:attendance_record",
  ]);
  return json(await scannerTargets(db, event.id, data.query));
});

export const EventScanCreate = openApiRoute(eventScanCreateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const authorization =
    data.body.action === "lead"
      ? await requireSponsorLeadPermission(c, data.params.eventSlug, data.body.sponsorId!)
      : await requireEventScannerPermission(c, data.params.eventSlug, scanActionCapability(data.body.action));
  const { actor, context, db, event } = authorization;
  const actionPermission =
    data.body.action === "lead"
      ? "agenda:leads_capture"
      : "permission" in authorization
        ? (authorization.permission as import("../../../../../assets/shared/schemas/permissions").Permission)
        : "agenda:admit";
  const attendancePermission = scannerPermission(
    (value) => hasPermission(actor, value, context),
    "agenda:attendance_record",
  );
  if (data.body.action === "exception" && data.body.recordAttendance && !attendancePermission)
    throw new AppError(403, "ATTENDANCE_PERMISSION_REQUIRED", "Attendance recording permission required.");
  if (data.body.operatorUserId !== actor.id)
    throw new AppError(403, "SCAN_OPERATOR_CHANGED", "Sign in as the original scanner operator to upload these scans.");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [
      { permission: actionPermission, context },
      ...(data.body.recordAttendance && attendancePermission ? [{ permission: attendancePermission, context }] : []),
      ...(data.body.action === "exception" ? [{ permission: "agenda:admit_exceptions" as const, context }] : []),
    ],
    () => new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again."),
  );
  return json(
    await receiveScannerUpload(guarded, event.id, data.body, async (uploadDb) => {
      if (data.body.action === "lead") {
        return captureSponsorLead(uploadDb, event.id, data.body.sponsorId!, actor.id, {
          operatorUserId: data.body.operatorUserId,
          operationId: data.body.operationId,
          deviceId: data.body.deviceId,
          consentConfirmed: true,
          badgeId: data.body.badgeId,
          observedAt: data.body.observedAt,
          capturePublicationRevision: data.body.capturePublicationRevision,
          nativeEventContext: data.body.nativeEventContext,
        });
      }
      return recordScan(
        uploadDb,
        event.id,
        {
          operatorUserId: actor.id,
          canScan: true,
          canAdmitExceptions: hasPermission(actor, "agenda:admit_exceptions", context),
        },
        data.body,
      );
    }),
  );
});
