import { formatDateTime } from "../../../../../../../shared/format-date";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import type { EligibilityManifest } from "./eligibility-manifest";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { formatNumber } from "../../../../../../../shared/format-number";
import { Button } from "../../../../../../ui/Button";

/** Last acknowledgment, queue and committed offline readiness are separate facts. */
export function ScannerSyncStatus({
  pending,
  lastSync,
  uploadStatus,
  collector,
  offline,
  action,
  sync,
}: {
  pending: number;
  lastSync: string | null | undefined;
  uploadStatus: string;
  collector?: ScannerOfflineContext;
  offline: { context: ScannerOfflineContext | null; preparing: boolean; error: string; retry: () => void };
  action: EventScanRequest["action"];
  sync?: () => void;
}) {
  const context = collector ?? offline.context;
  return (
    <section aria-label="Sync and offline status" class="pk-stack pk-stack--snug">
      <p role="status">
        {formatNumber(pending)} pending ·{" "}
        {lastSync ? `Last synced ${formatDateTime(lastSync)}` : "No retained sync acknowledgment"}
        {uploadStatus ? ` · ${uploadStatus}` : ""}
      </p>
      <p class="pk-muted">
        {collector
          ? "Offline collection · unverified until synced"
          : action === "lead"
            ? "Lead scans save locally and sync automatically when signed in and connected."
            : context
              ? `Offline scanner prepared until ${formatDateTime(context.expiresAt)}. Offline results remain unverified until synced.`
              : offline.preparing
                ? "Preparing offline scanner (recommended)…"
                : offline.error || "Prepare offline scanning while connected (recommended)."}
      </p>
      <div class="pk-cluster">
        {sync && (
          <Button type="button" variant="secondary" onClick={sync}>
            Sync now
          </Button>
        )}
        {!collector && action !== "lead" && !context && (
          <Button type="button" variant="ghost" disabled={offline.preparing} onClick={offline.retry}>
            Prepare offline scanner
          </Button>
        )}
      </div>
      {!collector && (
        <small class="pk-muted">
          Pending scans sync automatically when you reconnect. Preparation does not grant permission or establish
          admission.
        </small>
      )}
    </section>
  );
}

/** Explain preparation separately from the result of an individual badge scan. */
export function ScannerPreparationStatus({
  action,
  preparing,
  ready,
  error,
  stale = false,
  snapshot,
  lastSync,
}: {
  action: EventScanRequest["action"];
  preparing: boolean;
  ready: boolean;
  error: string;
  stale?: boolean;
  lastSync?: string | null;
  snapshot?: Pick<EligibilityManifest, "serverNow" | "expiresAt"> | null;
}) {
  return (
    <>
      <p>
        {preparing
          ? "Preparing fast eligibility checks…"
          : ready && stale
            ? "Using saved registration data. Refresh resumes when connected; scans upload in the background."
            : ready
              ? action === "checkout"
                ? "Badge data ready. Checkout saves locally and uploads in the background."
                : "Eligibility data ready. Checks run locally; attendance uploads in the background."
              : error || "Prepare eligibility data before scanning."}
      </p>
      <DescriptionList
        density="compact"
        items={[
          {
            term: "Last successful scan sync",
            value:
              lastSync === undefined
                ? "Not available"
                : lastSync === null
                  ? "No retained acknowledgment"
                  : formatDateTime(lastSync),
          },
        ]}
      />
      {lastSync && (
        <p class="pk-muted pk-small">
          Device-recorded time after a durable server acknowledgment; it does not establish attendance or current
          eligibility.
        </p>
      )}
      {snapshot && (
        <>
          <DescriptionList
            density="compact"
            items={[
              { term: "Last eligibility check", value: formatDateTime(snapshot.serverNow) },
              { term: "Snapshot expires", value: formatDateTime(snapshot.expiresAt) },
            ]}
          />
          <p class="pk-muted pk-small">These are server snapshot times. Later offline changes require a refresh.</p>
        </>
      )}
    </>
  );
}
