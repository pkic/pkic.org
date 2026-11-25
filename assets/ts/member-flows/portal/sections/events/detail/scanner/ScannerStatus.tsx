import type { EventScanResponse } from "../../../../../../../shared/schemas/event-participation-scanning";
import { useEffect, useState } from "preact/hooks";
import { IconCheckmark, IconInfoCircle, IconRemove } from "../../../../../../components/icons";

/** Presentation feedback; a requested print is not confirmation from a printer. */
export interface ScannerStatus {
  key: string;
  tone: EventScanResponse["outcome"];
  title: string;
  detail?: string;
  transient?: boolean;
  record?: boolean;
}

export function ScannerStatusIcon({ tone }: { tone: ScannerStatus["tone"] }) {
  return tone === "eligible" ? (
    <IconCheckmark />
  ) : tone === "denied" || tone === "unknown" ? (
    <IconRemove />
  ) : (
    <IconInfoCircle />
  );
}

/** A small, memory-only trail of completed operations, oldest to newest. */
export function useScannerStatus(status: ScannerStatus | undefined, fallback?: ScannerStatus) {
  const [history, setHistory] = useState<ScannerStatus[]>([]);
  const [dismissed, setDismissed] = useState("");
  const { key, tone, title, detail, transient, record } =
    (status?.record === false ? undefined : status) ?? fallback ?? {};
  useEffect(() => {
    if (!key || !tone || !title || record === false) return;
    setHistory((items) => [...items.filter((item) => item.key !== key), { key, tone, title, detail }].slice(-5));
    if (!transient) return;
    const timer = window.setTimeout(() => setDismissed(key), 1800);
    return () => window.clearTimeout(timer);
  }, [key, tone, title, detail, transient, record]);
  return {
    visible: status && (!status.transient || dismissed !== status.key) ? status : undefined,
    history: history.length ? history : fallback ? [fallback] : [],
  };
}

/** The last few results, oldest to newest; tapping one says what happened, since phones have no hover. */
export function ScannerResultTrail({ results }: { results: ScannerStatus[] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = results.find((result) => result.key === selectedKey);
  return (
    <div class="pk-fast-scanner__results" data-scanner-help="results">
      {results.length > 0 && (
        <ol class="pk-fast-scanner__trail" aria-label="Recent scan results">
          {results.map((result) => (
            <li key={result.key} data-tone={result.tone}>
              <button
                type="button"
                aria-pressed={result.key === selectedKey}
                onClick={() => setSelectedKey((current) => (current === result.key ? null : result.key))}
              >
                <span aria-hidden="true">
                  <ScannerStatusIcon tone={result.tone} />
                </span>
                <span class="pk-sr-only">{describeResult(result)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected && (
        <p class="pk-fast-scanner__trail-detail" role="status">
          {describeResult(selected)}
        </p>
      )}
    </div>
  );
}

function describeResult(result: ScannerStatus): string {
  return result.detail ? `${result.title}: ${result.detail}` : result.title;
}
