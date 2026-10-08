import { useEffect, useState, useRef } from "preact/hooks";
import { formatNumber } from "../../../../../../../shared/format-number";
import { Field } from "../../../../../../ui/Field";
import { FileInput } from "../../../../../../ui/FileInput";
import { importScanRecovery, CANONICAL_RECOVERY_EXPORT_BYTE_LIMIT } from "./scan-recovery-import";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { scanRecoverySchema } from "../../../../../../../shared/schemas/event-scan-recovery";
import {
  restoreScanHistory,
  scanHistoryCount,
  type HistoryCursor,
  scannerRecoverySnapshot,
  pendingRecoveryCount,
} from "./scan-history";

export function ScannerRecovery({
  slug,
  operatorUserId,
  sessionId,
  sponsorId,
}: {
  slug: string;
  operatorUserId: string;
  sessionId?: string;
  sponsorId?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const importing = useRef<AbortController | null>(null);
  useEffect(() => {
    setFile(null);
    setBusy(false);
    setMessage("");
    return () => importing.current?.abort();
  }, [slug, operatorUserId, sessionId]);
  const [count, setCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [epochCount, setEpochCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const [archived, pending, snapshot] = await Promise.all([
      scanHistoryCount(operatorUserId, slug),
      pendingRecoveryCount(operatorUserId, slug),
      scannerRecoverySnapshot(operatorUserId, slug),
    ]);
    setCount(archived);
    setPendingCount(pending);
    setEpochCount(snapshot.scannerEpochs.length);
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
      setMessage(
        `${formatNumber(restored)} scans queued for recovery. Original scan IDs prevent duplicate attendance.`,
      );
      window.dispatchEvent(new Event("online"));
      await refresh();
    } catch {
      setMessage("Recovery failed. Existing queued scans have been retained.");
    } finally {
      setBusy(false);
    }
  }
  async function importFile() {
    if (!file || !sessionId) return;
    setBusy(true);
    const controller = new AbortController();
    importing.current = controller;
    try {
      if (file.size > CANONICAL_RECOVERY_EXPORT_BYTE_LIMIT) throw new Error("Recovery file is too large.");
      const result = await importScanRecovery(await file.text(), {
        eventId: slug,
        operatorUserId,
        sessionId,
        sponsorId,
        signal: controller.signal,
      });
      setMessage(
        `Imported ${formatNumber(result.queued)} scans for recovery and ${formatNumber(result.archived)} uploaded receipts. Original scan IDs prevent duplicate attendance.`,
      );
      window.dispatchEvent(new Event("online"));
      await refresh();
    } catch {
      if (!controller.signal.aborted)
        setMessage(
          "Could not import this file. Connect to the internet and sign in with the original account for this event. Existing recovery records have been retained.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (importing.current === controller) importing.current = null;
    }
  }
  async function download() {
    setBusy(true);
    try {
      const { records, pending, scannerEpochs } = await scannerRecoverySnapshot(operatorUserId, slug);
      const payload = scanRecoverySchema.parse({
        version: 1,
        operatorUserId,
        eventId: slug,
        exportedAt: new Date().toISOString(),
        records,
        pending,
        scannerEpochs,
      });
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `scan-recovery-${slug}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        `Downloaded ${formatNumber(records.length)} uploaded scans and ${formatNumber(pending.length)} pending scans. The file contains usable badge codes. Keep it private.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "RECOVERY_LIMIT"
          ? `Recovery downloads support up to ${formatNumber(100000)} retained scans. No partial file was downloaded.`
          : "Could not create a recovery file.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader title="Recovery backup" />
      <PanelBody class="pk-form">
        <p>
          Uploaded scan records remain on this phone for {formatNumber(14)} days, including badge codes and minimal scan
          context. Pending uploads remain until the server acknowledges them. Browser storage can be cleared; download a
          separate recovery copy. Recovery files contain usable badge codes; keep them private. No attendee profiles or
          contact details are included.
        </p>
        <p>{formatNumber(count)} uploaded scans available for this event and your account.</p>
        <p>{formatNumber(pendingCount)} pending scans included in recovery downloads.</p>
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
          disabled={!count && !pendingCount && !epochCount}
          onClick={() => {
            void download();
          }}
        >
          Download recovery file
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
        <Field
          label="Recovery file"
          help="Choose a recovery JSON file downloaded for this event and your account. An internet connection is required to verify it."
        >
          {(control) => (
            <FileInput
              {...control}
              accept="application/json,.json"
              disabled={busy || !sessionId}
              onFileChange={setFile}
            />
          )}
        </Field>
        <Button type="button" loading={busy} disabled={!file || !sessionId} onClick={() => void importFile()}>
          Import recovery file
        </Button>
        {message && <p role="status">{message}</p>}
      </PanelBody>
    </Panel>
  );
}
