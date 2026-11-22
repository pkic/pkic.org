import {
  scannerDeviceEnrollmentRouteSchema,
  scannerDeviceStatusRouteSchema,
  scannerDeviceClosingRouteSchema,
  scannerDeviceResumptionRouteSchema,
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
  resumeScannerDeviceSession,
  guardScannerSponsorDatabase,
} from "../../../../_lib/services/event-participation/scanner-device-sessions";
import { requireEventScannerPermission } from "./authorization";
import { requireSponsorLeadPermission } from "./sponsor-authorization";
import { SCANNER_OFFLINE_MAXIMUM_MS } from "../../../../../assets/shared/event-offline-expiry";
import { nowIso } from "../../../../_lib/utils/time";
import type { EventRecord } from "../../../../_lib/services/events";

function withLeadLease<T extends object>(
  receipt: T,
  event: EventRecord,
  sponsorId?: string,
): T & {
  leadLease?: { eventId: string; sponsorId: string; serverNow: string; expiresAt: string };
} {
  if (!sponsorId) return receipt;
  const serverNow = nowIso();
  return {
    ...receipt,
    leadLease: {
      eventId: event.id,
      sponsorId,
      serverNow,
      expiresAt: new Date(Date.parse(serverNow) + SCANNER_OFFLINE_MAXIMUM_MS).toISOString(),
    },
  };
}

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
    return jsonNoStore(
      withLeadLease(await enrollScannerDevice(db, event.id, actor.id, data.body), event, data.body.sponsorId),
    );
  },
);
export const ScannerDeviceStatusGet = openApiRoute(scannerDeviceStatusRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, event } = await scannerAuthorization(c, data.params.eventSlug, data.query.sponsorId);
  return jsonNoStore(
    withLeadLease(
      await scannerDeviceSessionStatus(db, event.id, actor.id, data.params.epochId),
      event,
      data.query.sponsorId,
    ),
  );
});
export const ScannerDeviceClosingPost = openApiRoute(scannerDeviceClosingRouteSchema, async (c: AdminContext, data) => {
  const { db, actor, event } = await scannerAuthorization(c, data.params.eventSlug, data.body.sponsorId);
  return jsonNoStore(await closeScannerDeviceSession(db, event.id, actor.id, data.params.epochId, data.body));
});
export const ScannerDeviceResumptionPost = openApiRoute(
  scannerDeviceResumptionRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor, event } = await scannerAuthorization(c, data.params.eventSlug, data.body.sponsorId);
    return jsonNoStore(await resumeScannerDeviceSession(db, event.id, actor.id, data.params.epochId, data.body));
  },
);
