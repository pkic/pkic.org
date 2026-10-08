import { useEffect, useState } from "preact/hooks";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { OfflineScanRecord } from "../../../../../../../shared/schemas/event-participation-scanning";
import { DataTable } from "../../../../../../ui/DataTable";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
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
}: {
  slug: string;
  operatorUserId: string;
  pending: number;
  lastSync?: string | null;
  active?: boolean;
}) {
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<HistoryCursor>();
  const [history, setHistory] = useState<HistoryPage>();
  const [queued, setQueued] = useState<OfflineScanRecord[]>([]);
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
  if (!active) return null;
  return (
    <Panel>
      <PanelHeader title="Recent scans">
        {loadedScope === scope && `${formatNumber(queuedCount)} awaiting upload`}
      </PanelHeader>
      <PanelBody>
        <p>Saved scans for this event and your account on this device. No names or badge codes are shown.</p>
        {error && <p role="status">{error}</p>}
        {loading && <p role="status">Loading recent scans…</p>}
        {!cursor && loadedScope === scope && queued.length > 0 && (
          <DataTable
            caption="Scans awaiting upload"
            rows={queued}
            rowKey={(row) => row.scan.operationId}
            loading={loading}
            columns={[
              { id: "time", header: "Time", cell: (row) => formatDateTime(row.scan.observedAt) },
              { id: "action", header: "Action", cell: (row) => scannerActionLabel(row.scan.action) },
              { id: "state", header: "Upload", cell: () => "Awaiting acknowledgment" },
            ]}
          />
        )}
        {loadedScope === scope && queuedCount > 20 && !cursor && (
          <p>Showing {formatNumber(20)} pending scans. Sync to receive their results.</p>
        )}
        {loadedScope === scope && Boolean(history?.records.length) && (
          <DataTable
            caption="Uploaded scan results"
            rows={loadedScope === scope ? (history?.records ?? []) : []}
            rowKey={(row) => row.scan.operationId}
            loading={loading}
            empty="No retained uploaded scans."
            columns={[
              { id: "time", header: "Time", cell: (row) => formatDateTime(row.scan.observedAt) },
              { id: "action", header: "Action", cell: (row) => scannerActionLabel(row.scan.action) },
              { id: "result", header: "Result", cell: (row) => scanFeedbackLabel(row.receipt, row.scan.action) },
            ]}
          />
        )}
        {!loading && !error && loadedScope === scope && !history?.records.length && queuedCount === 0 && (
          <p>No recent scans on this device for this event.</p>
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
      </PanelBody>
    </Panel>
  );
}
