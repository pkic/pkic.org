import { useScannerLocation } from "./useScannerLocation";
import { useEligibilityManifest, useScannerOfflinePreparation } from "./useEligibilityManifest";
import { useOfflineAdmission } from "./useOfflineAdmission";
import type { ScannerEpoch } from "./scanner-device-ledger";
import type { PortalSession } from "../../../../types";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";

/** Keep location, eligibility and offline preparation on the same capture scope. */
export function useScannerPreparation({
  slug,
  operatorUserId,
  occurrenceId,
  action,
  collectorContext,
  epoch,
  session,
  onContextChange,
  onPermissionChanged,
}: {
  slug: string;
  operatorUserId: string;
  occurrenceId: string | null;
  action: EventScanRequest["action"];
  collectorContext?: ScannerOfflineContext;
  epoch: ScannerEpoch | null;
  session: PortalSession | null;
  onContextChange: () => void;
  onPermissionChanged: () => void;
}) {
  const location = useScannerLocation(slug, occurrenceId, action !== "lead", onContextChange, collectorContext);
  const eligibility = useEligibilityManifest(
    slug,
    operatorUserId,
    location.targetId,
    action,
    onPermissionChanged,
    location.roomId,
    epoch,
    Boolean(collectorContext),
  );
  const offlineAdmission = useOfflineAdmission(slug, operatorUserId, eligibility.eligibilityManifest, collectorContext);
  const offlinePreparation = useScannerOfflinePreparation(
    collectorContext ? null : session,
    epoch,
    eligibility.eligibilityManifest.current,
    slug,
    action,
  );
  const status = {
    occurrenceId: location.targetId,
    snapshot: eligibility.eligibilityManifest.current,
    stale: Boolean(
      eligibility.eligibilityManifest.current && Date.now() >= eligibility.eligibilityManifest.current.validUntil,
    ),
    action,
    preparing: eligibility.manifestPreparing,
    ready: eligibility.manifestReady,
    error: eligibility.manifestError,
  };
  return { location, eligibility, offlineAdmission, offlinePreparation, status };
}
