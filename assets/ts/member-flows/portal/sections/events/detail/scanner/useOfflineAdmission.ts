import { portalSession } from "../../../../state";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { EligibilityManifest } from "./eligibility-manifest";
import { queueScan } from "./scan-outbox";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { assertScannerOfflineContext } from "./scanner-offline-context";

/** Capture observations independently of registration or admission capacity. */
export function useOfflineAdmission(
  slug: string,
  operatorUserId: string,
  manifest: { current: EligibilityManifest | null },
  collector?: ScannerOfflineContext,
) {
  const sessionId = collector?.sessionId ?? portalSession.value?.sessionId;
  async function persist(scan: EventScanRequest) {
    if (collector) {
      await assertScannerOfflineContext(collector);
      if (
        scan.operatorUserId !== collector.operatorUserId ||
        scan.deviceId !== collector.deviceId ||
        scan.occurrenceId !== collector.occurrenceId ||
        (scan.roomId ?? null) !== (collector.roomId ?? null) ||
        scan.action !== collector.action
      )
        throw new Error("The scanner context changed. Reconnect before continuing.");
    }
    const prepared = collector ? null : manifest.current;
    const capturedScan = prepared
      ? {
          ...scan,
          capturePublicationRevision: prepared.publishedRevision,
          ...(prepared.nativeEventContext ? { nativeEventContext: prepared.nativeEventContext } : {}),
        }
      : collector
        ? {
            ...scan,
            capturePublicationRevision: collector.publishedRevision,
            ...(collector.nativeEventContext ? { nativeEventContext: collector.nativeEventContext } : {}),
          }
        : scan;
    const local = collector
      ? {
          outcome: "unverified" as const,
          reason: "verification_required" as const,
          message: "Scan saved on this device. Reconnect to verify and upload.",
        }
      : await prepared?.lookup(scan.badgeId, scan.action);
    const record = { eventId: slug, scan: capturedScan };
    const queuedScan = collector
      ? await queueScan(record, sessionId, collector)
      : sessionId === undefined
        ? await queueScan(record)
        : await queueScan(record, sessionId);
    return { scan: queuedScan, local };
  }
  return { persist, operatorUserId };
}
