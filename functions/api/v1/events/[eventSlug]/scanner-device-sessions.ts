import {
  scannerDeviceEnrollmentRouteSchema,
  scannerDeviceStatusRouteSchema,
  scannerDeviceClosingRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-scanner-devices";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  enrollScannerDevice,
  scannerDeviceSessionStatus,
  closeScannerDeviceSession,
  guardScannerSponsorDatabase,
} from "../../../../_lib/services/event-participation/scanner-device-sessions";
import { requireEventScannerPermission } from "./authorization";
import { requireSponsorLeadPermission } from "./sponsor-authorization";

async function scannerAuthorization(c: AdminContext, eventSlug: string, sponsorId?: string) {
  markResponseSensitive(c);
  const authorization = sponsorId
    ? await requireSponsorLeadPermission(c, eventSlug, sponsorId)
    : await requireEventScannerPermission(c, eventSlug, ["agenda:check", "agenda:admit", "agenda:attendance_record"]);
  const { db, actor, context, event } = authorization;
  const permission =
    "permission" in authorization
      ? (authorization.permission as import("../../../../../assets/shared/schemas/permissions").Permission)
      : ("agenda:leads_capture" as const);
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission, context }],
    () => new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again."),
  );
  return { actor, event, db: guardScannerSponsorDatabase(guarded, event.id, sponsorId) };
}
export const ScannerDeviceEnrollmentPost = openApiRoute(
  scannerDeviceEnrollmentRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor, event } = await scannerAuthorization(c, data.params.eventSlug, data.body.sponsorId);
    return jsonNoStore(await enrollScannerDevice(db, event.id, actor.id, data.body));
  },
);
export const ScannerDeviceStatusGet = openApiRoute(scannerDeviceStatusRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, event } = await scannerAuthorization(c, data.params.eventSlug, data.query.sponsorId);
  return jsonNoStore(await scannerDeviceSessionStatus(db, event.id, actor.id, data.params.epochId));
});
export const ScannerDeviceClosingPost = openApiRoute(scannerDeviceClosingRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, event } = await scannerAuthorization(c, data.params.eventSlug, data.body.sponsorId);
  return jsonNoStore(await closeScannerDeviceSession(db, event.id, actor.id, data.params.epochId, data.body));
});
