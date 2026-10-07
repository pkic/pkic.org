import { useRef, useState } from "preact/hooks";
import type { EventAttendanceRegistrationSummary } from "../../../shared/schemas/event-registrations";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
} from "../../../shared/schemas/route-contracts-event-badges";
import { formatNumber } from "../../../shared/format-number";
import { postJson } from "../../shared/api-client";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/PageHeader";
import { ErrorAlert } from "../ErrorAlert";
import { BadgePrintPreview } from "./BadgePrintPreview";
import type { FreshBadgePrint } from "./badge-print-artifacts";

/** Explicit page selection, with stable per-attendee retry receipts. */
export function RegistrationBadgePrinting({
  slug,
  rows,
  onBack,
}: {
  slug: string;
  rows: readonly EventAttendanceRegistrationSummary[];
  onBack: () => void;
}) {
  const [requests] = useState(() =>
    rows.map((row) => ({
      row,
      request: badgeIssueRequestSchema.parse({ operationId: crypto.randomUUID(), userId: row.user_id }),
    })),
  );
  const issued = useRef(new Map<string, Omit<FreshBadgePrint, "svg">>());
  const [printed, setPrinted] = useState<FreshBadgePrint[]>([]);
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  async function create() {
    if (busy) return;
    setBusy(true);
    if (
      completed.size === 0 &&
      !(await confirmAction({
        title: "Create badges for selected registrations?",
        body: `Create ${formatNumber(requests.length)} additional credentials. Existing badges remain valid. Save the print files before leaving this page.`,
        confirmLabel: "Create selected badges",
      }))
    ) {
      setBusy(false);
      return;
    }
    setError("");
    try {
      const { default: QR } = await import("qrcode");
      for (const { row, request } of requests) {
        if (completed.has(row.id)) continue;
        let fresh = issued.current.get(row.id);
        if (!fresh) {
          const result = await postJson(
            `/api/v1/events/${encodeURIComponent(slug)}/badges`,
            request,
            badgeIssueResponseSchema,
          );
          if (result.result === "replayed") {
            setMissing(true);
            setCompleted((previous) => new Set([...previous, row.id]));
            continue;
          }
          fresh = { id: result.id, credential: result.credential, displayName: row.display_name ?? "Attendee" };
          issued.current.set(row.id, fresh);
        }
        const svg = await QR.toString(fresh.credential, { type: "svg", errorCorrectionLevel: "M", margin: 4 });
        const printable = { ...fresh, svg };
        setPrinted((previous) => [...previous, printable]);
        setCompleted((previous) => new Set([...previous, row.id]));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create selected badges.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="pk-stack">
      <PageHeader title="Print selected attendee badges" />
      <p>
        Scope: {formatNumber(requests.length)} selected registrations on the loaded page. Search results on other pages
        are not included. Each attendee receives an additional credential; no existing badge is replaced.
      </p>
      <p>
        {formatNumber(completed.size)} of {formatNumber(requests.length)} requests completed.
      </p>
      {missing && (
        <Alert tone="info">
          A completed request did not return its original code. It has not been issued again. Manage that attendee’s
          badges to explicitly replace a credential if needed.
        </Alert>
      )}
      {error && <ErrorAlert error={error} />}
      <div class="pk-cluster">
        <Button loading={busy} disabled={completed.size === requests.length} onClick={() => void create()}>
          {completed.size ? "Retry remaining requests" : "Create selected badges"}
        </Button>
        <Button disabled={busy} onClick={onBack}>
          Back to registrations
        </Button>
      </div>
      {printed.length > 0 && <BadgePrintPreview badges={printed} />}
    </div>
  );
}
