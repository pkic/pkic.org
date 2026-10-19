import { useEffect, useState } from "preact/hooks";
import { formatDate, formatDateTime, formatTimeOfDay } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { ScannerQueueRecord } from "../../../../../../../shared/schemas/event-scanner-offline-queue";
import { DataTable } from "../../../../../../ui/DataTable";
import { Alert } from "../../../../../../ui/Alert";
import { Badge } from "../../../../../../ui/Badge";
import { Button } from "../../../../../../ui/Button";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { listScanHistory, type HistoryCursor, type HistoryPage } from "./scan-history";
import { recentPendingScans } from "./scanner-recent-scans";
import { scanFeedbackLabel } from "./scan-stream";
import { scannerActionLabel } from "./ScannerModeSelect";

export function ScannerRecentScans({
  slug,
  operatorUserId,
  pending,
  lastSync,
  active = true,
  limit = 20,
  action,
}: {
  slug: string;
  operatorUserId: string;
  pending: number;
  lastSync?: string | null;
  active?: boolean;
  limit?: number;
  /** Current capture mode, so only a different historical mode needs a label. */
  action?: ScannerQueueRecord["scan"]["action"];
}) {
  const [refresh, setRefresh] = useState(0);

  const [cursor, setCursor] = useState<HistoryCursor>();
  const [history, setHistory] = useState<HistoryPage>();
  const [queued, setQueued] = useState<ScannerQueueRecord[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const scope = JSON.stringify([slug, operatorUserId]);
  const [loadedScope, setLoadedScope] = useState("");
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setError("");
    void Promise.all([listScanHistory(operatorUserId, slug, cursor, 20), recentPendingScans(operatorUserId, slug)])
      .then(([history, queued]) => {
        if (alive) {
          setHistory(history);
          setQueued(queued.records);
          setQueuedCount(queued.total);
          setLoadedScope(scope);
        }
      })
      .catch(() => {
        if (alive) setError("Recent scans are unavailable. Retained scans have not been changed.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, slug, operatorUserId, pending, lastSync, cursor, refresh, scope]);
  const rows = [
    ...(!cursor && loadedScope === scope ? queued : []).map((row) => ({
      id: row.scan.operationId,
      observedAt: row.scan.observedAt,
      action: row.scan.action,
      result: row.kind === "failure" ? "Scan could not be completed" : "Verification pending",
      scannedValue: row.scan.scannedValue,
      truncated: row.scan.scannedValueTruncated,
      pending: true,
    })),
    ...(loadedScope === scope ? (history?.records ?? []) : []).map((row) => ({
      id: row.scan.operationId,
      observedAt: row.scan.observedAt,
      action: row.scan.action,
      result: scanFeedbackLabel(row.receipt, row.scan.action),
      scannedValue: row.scan.scannedValue,
      truncated: row.scan.scannedValueTruncated,
      pending: false,
    })),
  ]
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, Math.max(1, Math.min(limit, 20)));
  if (!active) return null;
  return (
    <section class="pk-stack pk-stack--snug" aria-label="Recent scans">
      <div class="pk-cluster pk-cluster--between">
        <SectionHeading level={3}>Recent scans</SectionHeading>
        {loadedScope === scope && queuedCount > 0 && (
          <span class="pk-small pk-muted">{formatNumber(queuedCount)} pending sync</span>
        )}
      </div>
      {error && <Alert tone="warn">{error}</Alert>}
      {loading && rows.length === 0 && <p role="status">Loading recent scans…</p>}
      {rows.length > 0 && (
        <DataTable
          caption="Recent scan attempts and results"
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              id: "result",
              header: "Result",
              width: "primary",
              cell: (row) => (
                <>
                  {row.result}
                  {row.pending && (
                    <>
                      {" "}
                      <Badge tone="warn">Pending sync</Badge>
                    </>
                  )}
                </>
              ),
            },
            {
              id: "observedAt",
              header: "Time",
              width: "fit",
              cell: (row) => (
                <time dateTime={row.observedAt} title={formatDateTime(row.observedAt)}>
                  {formatDate(row.observedAt)} · {formatTimeOfDay(row.observedAt)}
                </time>
              ),
            },
            ...(rows.some((row) => !action || row.action !== action)
              ? [
                  {
                    id: "action",
                    header: "Mode",
                    width: "fit" as const,
                    cell: (row: (typeof rows)[number]) => scannerActionLabel(row.action),
                  },
                ]
              : []),
            {
              id: "scannedValue",
              header: "Scanned value",
              width: "primary",
              cell: (row) => (
                <code class="pk-scanner-captured-value" title={row.scannedValue}>
                  {row.scannedValue}
                  {row.truncated ? " (truncated)" : ""}
                </code>
              ),
            },
          ]}
        />
      )}
      {!loading && !error && loadedScope === scope && rows.length === 0 && (
        <EmptyState title="No recent scans" body="Scans made on this device for this event appear here." />
      )}
      <div class="pk-cluster">
        <Button
          type="button"
          variant="secondary"
          disabled={loading}
          onClick={() => {
            setCursor(undefined);
            setRefresh((value) => value + 1);
          }}
        >
          Latest scans
        </Button>
        {loadedScope === scope && history?.nextCursor && (
          <Button type="button" variant="secondary" disabled={loading} onClick={() => setCursor(history.nextCursor!)}>
            Older scans
          </Button>
        )}
      </div>
    </section>
  );
}
