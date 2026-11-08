import { useEffect, useRef, useState } from "preact/hooks";
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
  onContextChange: (message?: string) => void;
  onPermissionChanged: () => void;
}) {
  const captureClosed = useRef(false);
  const [closedMessage, setClosedMessage] = useState("");
  useEffect(() => {
    captureClosed.current = false;
    setClosedMessage("");
  }, [epoch?.epochId]);
  const location = useScannerLocation(slug, occurrenceId, action !== "lead", onContextChange, collectorContext);
  const eligibility = useEligibilityManifest({
    slug,
    operatorUserId,
    occurrenceId: location.targetId,
    action,
    onPermissionChanged,
    roomId: location.roomId,
    epoch,
    collector: Boolean(collectorContext),
    onPreparationClosed: (message) => {
      captureClosed.current = true;
      setClosedMessage(message);
      onContextChange(message);
    },
  });
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
    error: closedMessage || eligibility.manifestError,
    checkedBadges: eligibility.manifestProgress,
  };
  return { location, eligibility, offlineAdmission, offlinePreparation, status, captureClosed, closedMessage };
}
