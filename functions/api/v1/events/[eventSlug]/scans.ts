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
import { requireEventPermission } from "./authorization";
import { captureSponsorLead } from "../../../../_lib/services/event-participation/sponsor-leads";
import { scannerTargets } from "../../../../_lib/services/event-participation/reporting";
export const ScannerTargetsGet = openApiRoute(scannerTargetsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:scan");
  return json(await scannerTargets(db, event.id, data.query));
});

export const EventScanCreate = openApiRoute(eventScanCreateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { actor, context, db, event } =
    data.body.action === "lead"
      ? await requireSponsorLeadPermission(c, data.params.eventSlug, data.body.sponsorId!)
      : await requireEventPermission(c, data.params.eventSlug, "agenda:scan");
  if (data.body.operatorUserId !== actor.id)
    throw new AppError(403, "SCAN_OPERATOR_CHANGED", "Sign in as the original scanner operator to upload these scans.");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [
      { permission: data.body.action === "lead" ? "agenda:leads_capture" : "agenda:scan", context },
      ...(data.body.action === "exception" ? [{ permission: "agenda:admit_exceptions" as const, context }] : []),
    ],
    () => new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again."),
  );
  if (data.body.action === "lead") {
    const result = await captureSponsorLead(guarded, event.id, data.body.sponsorId!, actor.id, {
      operatorUserId: data.body.operatorUserId,
      operationId: data.body.operationId,
      deviceId: data.body.deviceId,
      consentConfirmed: true,
      badgeId: data.body.badgeId,
      observedAt: data.body.observedAt,
    });
    return json({
      operationId: data.body.operationId,
      outcome: result.captured
        ? "eligible"
        : result.reason === "unknown_credential"
          ? "unknown"
          : result.reason === "consent_required"
            ? "warning"
            : "denied",
      reason: result.captured
        ? "eligible"
        : result.reason === "unknown_credential"
          ? "unknown_credential"
          : result.reason,
      recorded: result.recorded,
      attendanceRecorded: false,
    });
  }
  return json(
    await recordScan(
      guarded,
      event.id,
      {
        operatorUserId: actor.id,
        canScan: true,
        canAdmitExceptions: hasPermission(actor, "agenda:admit_exceptions", context),
      },
      data.body,
    ),
  );
});
