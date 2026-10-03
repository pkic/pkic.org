import type { OfflineScanRecord } from "../../../../../../../shared/schemas/event-participation-scanning";
import { useEffect, useState } from "preact/hooks";
import { Button } from "../../../../../../ui/Button";
import { scanRecoverySchema, type ArchivedScan } from "../../../../../../../shared/schemas/event-scan-recovery";
import {
  listScanHistory,
  restoreScanHistory,
  scanHistoryCount,
  type HistoryCursor,
  pendingRecoveryPage,
  pendingRecoveryCount,
} from "./scan-history";

export function ScannerRecovery({ slug, operatorUserId }: { slug: string; operatorUserId: string }) {
  const [count, setCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const [archived, pending] = await Promise.all([
      scanHistoryCount(operatorUserId, slug),
      pendingRecoveryCount(operatorUserId, slug),
    ]);
    setCount(archived);
    setPendingCount(pending);
  };
  useEffect(() => {
    void refresh().catch(() => setMessage("Local recovery storage is unavailable."));
  }, [slug, operatorUserId]);
  async function restore() {
    setBusy(true);
    try {
      let cursor: HistoryCursor | undefined;
      let restored = 0;
      do {
        const page = await restoreScanHistory(operatorUserId, slug, cursor);
        restored += page.restored;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      setMessage(`${restored} scans queued for recovery. Original scan IDs prevent duplicate attendance.`);
      window.dispatchEvent(new Event("online"));
      await refresh();
    } catch {
      setMessage("Recovery failed. Existing queued scans have been retained.");
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    try {
      const records: ArchivedScan[] = [];
      let cursor: HistoryCursor | undefined;
      do {
        const page = await listScanHistory(operatorUserId, slug, cursor);
        records.push(...page.records);
        cursor = page.nextCursor ?? undefined;
        if (records.length > 100000) throw new Error("RECOVERY_LIMIT");
      } while (cursor);
      const pending: OfflineScanRecord[] = [];
      let pendingCursor: string | undefined;
      do {
        const page = await pendingRecoveryPage(operatorUserId, slug, pendingCursor);
        pending.push(...page.records);
        pendingCursor = page.nextCursor ?? undefined;
        if (records.length + pending.length > 100000) throw new Error("RECOVERY_LIMIT");
      } while (pendingCursor);
      const payload = scanRecoverySchema.parse({
        version: 1,
        operatorUserId,
        eventId: slug,
        exportedAt: new Date().toISOString(),
        records,
        pending,
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `scan-recovery-${slug}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        `Downloaded ${records.length} uploaded scans and ${pending.length} pending scans. The backup contains IDs and outcomes only.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "RECOVERY_LIMIT"
          ? "Recovery downloads support up to 100,000 retained scans. No partial file was downloaded."
          : "Could not create a recovery file.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={() => {
        void refresh().catch(() => {});
      }}
    >
      <summary>Recovery backup</summary>
      <p>
        Uploaded scans remain on this phone for 14 days using IDs, timestamps, and outcomes only. Pending uploads remain
        until the server acknowledges them. Browser storage can be cleared; download a separate recovery copy.
      </p>
      <p>{count} uploaded scans available for this event and your account.</p>
      <p>{pendingCount} pending scans included in recovery downloads.</p>
      <Button
        type="button"
        loading={busy}
        disabled={!count}
        onClick={() => {
          void restore();
        }}
      >
        Restore uploaded scans
      </Button>{" "}
      <Button
        type="button"
        loading={busy}
        disabled={!count && !pendingCount}
        onClick={() => {
          void download();
        }}
      >
        Download recovery IDs
      </Button>{" "}
      <Button
        type="button"
        onClick={() => {
          void navigator.storage
            ?.persist?.()
            .then((kept) =>
              setMessage(
                kept ? "Browser storage retention enabled." : "The browser manages storage retention on this phone.",
              ),
            )
            .catch(() => setMessage("The browser manages storage retention on this phone."));
        }}
      >
        Keep browser storage
      </Button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
