import { scannerFailureRouteSchema } from "../../../../../assets/shared/schemas/event-scanner-failure";
import { scanActionCapability, scannerPermission } from "../../../../../assets/shared/event-scanner-permissions";
import { guardPermissionDatabase, hasPermission } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { receiveScannerUpload } from "../../../../_lib/services/event-participation/scanner-upload-receipts";
import { guardSponsorCaptureDatabase } from "../../../../_lib/services/event-participation/lead-scope";
import { recordScannerFailure } from "../../../../_lib/services/event-participation/scanner-failures";
import { requireSponsorLeadPermission } from "./sponsor-authorization";
import { requireEventScannerPermission } from "./authorization";

export const ScannerFailureCreate = openApiRoute(scannerFailureRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const authorization =
    data.body.action === "lead"
      ? await requireSponsorLeadPermission(c, data.params.eventSlug, data.body.sponsorId!)
      : await requireEventScannerPermission(c, data.params.eventSlug, scanActionCapability(data.body.action));
  const { actor, context, db, event } = authorization;
  if (data.body.operatorUserId !== actor.id)
    throw new AppError(
      403,
      "SCAN_OPERATOR_CHANGED",
      "Sign in as the original scanner operator to upload these attempts.",
    );
  const permission =
    data.body.action === "lead"
      ? "agenda:leads_capture"
      : scannerPermission((value) => hasPermission(actor, value, context), scanActionCapability(data.body.action));
  if (!permission)
    throw new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again.");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission, context }],
    () => new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again."),
  );
  return json(
    await receiveScannerUpload(
      data.body.action === "lead" ? guardSponsorCaptureDatabase(guarded, actor.id, data.body.sponsorId!) : guarded,
      event.id,
      data.body,
      (uploadDb) => recordScannerFailure(uploadDb, event.id, data.body),
    ),
  );
});
