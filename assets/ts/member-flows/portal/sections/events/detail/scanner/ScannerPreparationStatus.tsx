import { formatDateTime } from "../../../../../../../shared/format-date";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import type { EligibilityManifest } from "./eligibility-manifest";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";

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
