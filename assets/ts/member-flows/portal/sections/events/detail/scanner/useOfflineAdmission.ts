import { portalSession } from "../../../../state";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { EligibilityManifest } from "./eligibility-manifest";
import { queueScan } from "./scan-outbox";

/** Capture observations independently of registration or admission capacity. */
export function useOfflineAdmission(
  slug: string,
  operatorUserId: string,
  manifest: { current: EligibilityManifest | null },
) {
  const sessionId = portalSession.value?.sessionId;
  async function persist(scan: EventScanRequest) {
    const prepared = manifest.current;
    const capturedScan = prepared
      ? {
          ...scan,
          capturePublicationRevision: prepared.publishedRevision,
          ...(prepared.nativeEventContext ? { nativeEventContext: prepared.nativeEventContext } : {}),
        }
      : scan;
    const local = await prepared?.lookup(scan.badgeId, scan.action);
    const record = { eventId: slug, scan: capturedScan };
    const queuedScan = sessionId === undefined ? await queueScan(record) : await queueScan(record, sessionId);
    return { scan: queuedScan, local };
  }
  return { persist, operatorUserId };
}
