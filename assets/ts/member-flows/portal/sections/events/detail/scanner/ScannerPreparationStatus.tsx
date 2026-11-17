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
  refreshEligibility,
  syncing = false,
  preparing = false,
  children,
}: {
  pending: number;
  uploadStatus: string;
  collector?: ScannerOfflineContext;
  offline: { context: ScannerOfflineContext | null; preparing: boolean; error: string; retry: () => void };
  action: EventScanRequest["action"];
  sync?: () => void;
  refreshEligibility?: () => Promise<void>;
  syncing?: boolean;
  preparing?: boolean;
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
            aria-label="Sync now"
            aria-busy={syncing || preparing}
            onClick={() => {
              void refreshEligibility?.();
              if (!syncing) sync();
            }}
          >
            {syncing || preparing ? "Sync now · in progress…" : "Sync now"}
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
  sessionOnly = false,
  snapshot,
  lastSync,
  checkedBadges = null,
  badgeCollection = false,
}: {
  action: EventScanRequest["action"];
  occurrenceId?: string | null;
  preparing: boolean;
  ready: boolean;
  error: string;
  stale?: boolean;
  sessionOnly?: boolean;
  lastSync?: string | null;
  checkedBadges?: number | null;
  badgeCollection?: boolean;
  snapshot?: Pick<
    EligibilityManifest,
    "serverNow" | "expiresAt" | "badgeNamesPrepared" | "badgeNamesUnavailable"
  > | null;
}) {
  return (
    <>
      {error && !preparing && (!ready || sessionOnly || stale) ? (
        <Alert tone="warn">
          <p>{error}</p>
          {ready && !sessionOnly && (
            <p>
              {stale
                ? "Saved badge data is more than a day old. Scans still save on this device; reconnect to refresh badge checks."
                : "Using saved badge data; its original expiry still applies."}
            </p>
          )}
        </Alert>
      ) : (
        <p role="status">
          {preparing && !ready
            ? checkedBadges === null
              ? badgeCollection
                ? "Preparing badge names…"
                : "Preparing scanner…"
              : `Refreshing badge data · ${formatNumber(checkedBadges)} badges checked…`
            : ready && stale
              ? "Badge data is more than a day old. Refresh when connected; scanning can continue."
              : ready && badgeCollection
                ? snapshot?.badgeNamesPrepared
                  ? "Badge names prepared for offline collection."
                  : "Check-in prepared. Some badge names are unavailable offline."
                : ready && checkedBadges !== null
                  ? `Badge data up to date · ${formatNumber(checkedBadges)} badges checked.`
                  : ready
                    ? action === "checkout"
                      ? "Badge data ready. Checkout saves locally and uploads in the background."
                      : "Badge data ready. Checks run locally; attendance uploads in the background."
                    : "Prepare badge data before scanning."}
        </p>
      )}
      {error && ready && !preparing && !sessionOnly && !stale && <p class="pk-muted">{error}</p>}
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
                { term: "Offline access ends", value: formatDateTime(snapshot.expiresAt) },
              ]
            : []),
        ]}
      />
    </>
  );
}
