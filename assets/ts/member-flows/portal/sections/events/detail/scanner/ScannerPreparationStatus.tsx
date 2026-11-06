import { formatDateTime } from "../../../../../../../shared/format-date";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import type { EligibilityManifest } from "./eligibility-manifest";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { formatNumber } from "../../../../../../../shared/format-number";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import type { ComponentChildren } from "preact";
import { useScannerConnection } from "./useScannerConnection";
import { Alert } from "../../../../../../ui/Alert";

/** Last acknowledgment, queue and committed offline readiness are separate facts. */
export function ScannerSyncStatus({
  pending,
  uploadStatus,
  collector,
  offline,
  action,
  sync,
  syncing = false,
  refreshEligibility,
  children,
}: {
  pending: number;
  uploadStatus: string;
  collector?: ScannerOfflineContext;
  offline: { context: ScannerOfflineContext | null; preparing: boolean; error: string; retry: () => void };
  action: EventScanRequest["action"];
  sync?: () => void;
  syncing?: boolean;
  refreshEligibility?: () => Promise<void>;
  children?: ComponentChildren;
}) {
  const context = collector ?? offline.context;
  const online = useScannerConnection();
  return (
    <Panel aria-label="Sync and offline status">
      <PanelHeader title="Sync status">
        {sync && (
          <Button
            type="button"
            variant="secondary"
            loading={syncing}
            onClick={() => {
              sync();
              void refreshEligibility?.();
            }}
          >
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        <div class="pk-grid pk-grid--cards">
          <div class="pk-stack pk-stack--snug">
            <p role="status">
              {online && !collector ? "Online · " : "Offline · "}
              {pending ? `${formatNumber(pending)} pending scans` : "No pending scans"}
              {syncing
                ? " · Sync in progress…"
                : uploadStatus && uploadStatus !== "All pending scans uploaded."
                  ? ` · ${uploadStatus}`
                  : ""}
            </p>
            <p class="pk-muted">
              {collector
                ? "Offline scanning · checks use prepared badge data"
                : action === "lead"
                  ? "Lead scans sync automatically when connected. Names and contact details stay off this device."
                  : context
                    ? `Offline scanner prepared until ${formatDateTime(context.expiresAt)}. Badge checks run locally; scan records upload when connected.`
                    : offline.preparing
                      ? "Preparing offline scanner…"
                      : offline.error || "Prepare offline scanning while connected."}
            </p>
            {!collector && action !== "lead" && !context && (
              <div class="pk-cluster">
                <Button type="button" variant="secondary" loading={offline.preparing} onClick={offline.retry}>
                  Prepare offline scanner
                </Button>
              </div>
            )}
          </div>
          <div class="pk-stack pk-stack--snug">{children}</div>
        </div>
      </PanelBody>
    </Panel>
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
  checkedBadges = null,
}: {
  action: EventScanRequest["action"];
  occurrenceId?: string | null;
  preparing: boolean;
  ready: boolean;
  error: string;
  stale?: boolean;
  lastSync?: string | null;
  checkedBadges?: number | null;
  snapshot?: Pick<EligibilityManifest, "serverNow" | "expiresAt"> | null;
}) {
  return (
    <>
      {error && !preparing ? (
        <Alert tone="warn">
          <p>{error}</p>
          {ready && <p>Using saved registration data; its original expiry still applies.</p>}
        </Alert>
      ) : (
        <p role="status">
          {preparing
            ? checkedBadges === null
              ? "Refreshing badge data…"
              : `Refreshing badge data · ${formatNumber(checkedBadges)} badges checked…`
            : ready && stale
              ? "Using saved registration data. Refresh resumes when connected; scans upload in the background."
              : ready && checkedBadges !== null
                ? `Badge data up to date · ${formatNumber(checkedBadges)} badges checked.`
                : ready
                  ? action === "checkout"
                    ? "Badge data ready. Checkout saves locally and uploads in the background."
                    : "Eligibility data ready. Checks run locally; attendance uploads in the background."
                  : "Prepare eligibility data before scanning."}
        </p>
      )}
      <DescriptionList
        density="compact"
        items={[
          {
            term: "Last successful scan sync",
            value:
              lastSync === undefined
                ? "Not available"
                : lastSync === null
                  ? "No recent upload"
                  : formatDateTime(lastSync),
          },
          ...(snapshot
            ? [
                { term: "Last badge refresh", value: formatDateTime(snapshot.serverNow) },
                { term: "Badge data valid until", value: formatDateTime(snapshot.expiresAt) },
              ]
            : []),
        ]}
      />
    </>
  );
}
