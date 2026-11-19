import { useEffect, useState } from "preact/hooks";
import { formatAge, formatDateTime } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { IconCheckmark } from "../../../../../../components/icons";

export function scannerConnectionLabel({
  pending,
  online,
  syncing,
  ready = true,
  error = "",
  collector = false,
}: {
  pending: number;
  online: boolean;
  syncing: boolean;
  ready?: boolean;
  error?: string;
  collector?: boolean;
}) {
  if (error) return error;
  if (!ready) return "Checking saved scans…";
  if (!online || collector)
    return pending ? `Offline · ${formatNumber(pending)} saved on this device` : "Offline · no pending scans";
  if (pending)
    return syncing
      ? `Uploading · ${formatNumber(pending)} pending`
      : `${formatNumber(pending)} saved on this device · retrying automatically`;
  return syncing ? "Checking uploads…" : "All scans synced";
}

export interface ScannerReadiness {
  preparing: boolean;
  ready: boolean;
  error: string;
  checkedBadges?: number | null;
  badgeCollection?: boolean;
  badgeNamesPrepared?: boolean;
}

export function scannerReadinessLabel(preparation: ScannerReadiness): string {
  const preparing = preparation.preparing && !preparation.ready;
  return preparing
    ? `${preparation.badgeCollection ? "Preparing badge names" : "Preparing scanner"}${preparation.checkedBadges == null ? "…" : ` · ${formatNumber(preparation.checkedBadges)} badges checked…`}`
    : preparation.ready
      ? preparation.badgeCollection && !preparation.badgeNamesPrepared
        ? "Some badge names unavailable offline"
        : preparation.badgeCollection
          ? "Badge names ready"
          : "Badge data ready"
      : preparation.error || "Preparing scanner…";
}

/** One operator status bar combines readiness, connection, pending uploads and the last acknowledgment. */
export function ScannerConnectionStatus({
  uploadStatus = "",
  lastSync,
  offlinePrepared,
  preparation,
  compact = false,
  ...props
}: Parameters<typeof scannerConnectionLabel>[0] & {
  uploadStatus?: string;
  lastSync?: string | null;
  offlinePrepared?: boolean;
  preparation?: ScannerReadiness;
  compact?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const current = Date.now();
    setNow(current);
    if (!lastSync || !Number.isFinite(Date.parse(lastSync)) || current - Date.parse(lastSync) >= 12 * 60 * 60_000)
      return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current - Date.parse(lastSync) >= 12 * 60 * 60_000) window.clearInterval(timer);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [lastSync]);
  const syncAge = lastSync ? now - Date.parse(lastSync) : null;
  const syncExact = lastSync ? formatDateTime(lastSync) : "";
  const syncLabel =
    syncAge !== null && syncAge >= 0 && syncAge < 12 * 60 * 60_000
      ? syncAge < 60_000
        ? "just now"
        : formatAge(syncAge)
      : syncExact;
  const error =
    props.error ||
    (uploadStatus.startsWith("Sign in") ||
    uploadStatus.startsWith("A retained") ||
    uploadStatus.startsWith("Sync unavailable") ||
    uploadStatus.startsWith("Scan upload")
      ? uploadStatus
      : "");
  const readiness = preparation ? scannerReadinessLabel(preparation) : null;
  const connection = props.online && !props.collector ? "Online" : "Offline";
  const uploads = props.pending
    ? `${formatNumber(props.pending)} awaiting upload${props.syncing ? " · syncing…" : ""}`
    : props.syncing
      ? "Checking uploads…"
      : "All scans synced";
  if (compact) {
    const label =
      error ||
      (props.ready === false ? "Checking saved scans…" : "") ||
      (preparation && !preparation.ready ? readiness : "") ||
      (preparation?.badgeCollection && preparation.ready && !preparation.badgeNamesPrepared ? readiness : "") ||
      (offlinePrepared === false && preparation?.ready ? "Keep open to scan offline" : "") ||
      (!props.online || props.collector ? (props.pending ? `Offline · ${uploads}` : "Offline") : "") ||
      uploads;
    const synced = label === "All scans synced";
    return (
      <span
        class="pk-scanner-connection pk-scanner-connection--compact"
        role="status"
        aria-live="polite"
        aria-label="Scanner status"
        title={label}
      >
        {synced ? <IconCheckmark aria-hidden="true" /> : label}
        {synced && <span class="pk-sr-only">{label}</span>}
      </span>
    );
  }
  return (
    <div class="pk-scanner-connection" role="status" aria-live="polite" aria-label="Scanner status">
      {readiness && <span>{readiness}</span>}
      <span>{connection}</span>
      {offlinePrepared === false && preparation?.ready && <span>Keep open to scan offline</span>}
      <span>{error || (props.ready === false ? "Checking saved scans…" : uploads)}</span>
      {lastSync !== undefined && (
        <span>
          {lastSync ? (
            <>
              Last synced{" "}
              <time dateTime={lastSync} title={syncExact} aria-label={syncExact} tabIndex={0}>
                {syncLabel}
              </time>
            </>
          ) : (
            "No recent sync"
          )}
        </span>
      )}
    </div>
  );
}
