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
  sponsorId,
  sponsorName,
  allowedActions,
  collectorContext,
  badgeCollection = false,
  epoch,
  session,
  onContextChange,
  onPermissionChanged,
  onPreparationClosed,
}: {
  slug: string;
  operatorUserId: string;
  occurrenceId: string | null;
  action: EventScanRequest["action"];
  sponsorId?: string;
  sponsorName?: string;
  allowedActions: readonly EventScanRequest["action"][];
  collectorContext?: ScannerOfflineContext;
  badgeCollection?: boolean;
  epoch: ScannerEpoch | null;
  session: PortalSession | null;
  onContextChange: (message?: string) => void;
  onPermissionChanged: () => void;
  onPreparationClosed: (code: string) => void;
}) {
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
    includeBadgeNames:
      badgeCollection || (location.targetId === null && allowedActions.includes("attendance") && action !== "lead"),
    onPreparationClosed: (message, code) => {
      onContextChange(message);
      onPreparationClosed(code);
    },
  });
  const offlineAdmission = useOfflineAdmission(slug, operatorUserId, eligibility.eligibilityManifest, collectorContext);
  const offlinePreparation = useScannerOfflinePreparation(
    collectorContext ? null : session,
    epoch,
    eligibility.eligibilityManifest.current,
    slug,
    action,
    action === "lead" ? sponsorName : location.targetLabel,
    location.rooms.find((room) => room.id === location.roomId)?.name,
    { occurrenceId: location.targetId, roomId: location.roomId },
    allowedActions,
    badgeCollection ? "collection" : "scan",
    sponsorId,
  );
  const status = {
    occurrenceId: location.targetId,
    snapshot: eligibility.eligibilityManifest.current,
    stale: Boolean(
      eligibility.eligibilityManifest.current &&
      Date.now() - Date.parse(eligibility.eligibilityManifest.current.serverNow) >= 24 * 60 * 60_000,
    ),
    action,
    badgeCollection,
    badgeNamesPrepared: eligibility.eligibilityManifest.current?.badgeNamesPrepared,
    preparing: eligibility.manifestPreparing,
    ready: eligibility.manifestReady,
    error: eligibility.manifestError,
    checkedBadges: eligibility.manifestProgress,
    sessionOnly: Boolean(eligibility.eligibilityManifest.current?.storageError),
  };
  return { location, eligibility, offlineAdmission, offlinePreparation, status };
}
