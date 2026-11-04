import { formatNumber } from "../../../../../../../shared/format-number";

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
  return "All scans synced";
}

/** Always visible, including while capturing; upload status never gates the next badge. */
export function ScannerConnectionStatus({
  uploadStatus = "",
  ...props
}: Parameters<typeof scannerConnectionLabel>[0] & { uploadStatus?: string }) {
  const error =
    props.error ||
    (uploadStatus.startsWith("Sign in") ||
    uploadStatus.startsWith("A retained") ||
    uploadStatus.startsWith("Sync unavailable")
      ? uploadStatus
      : "");
  return (
    <p class="pk-scanner-connection" role="status" aria-live="polite">
      {scannerConnectionLabel({ ...props, error })}
    </p>
  );
}
