import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { BADGE_LABEL_PRINTING_CONTEXT } from "../../../shared/badge-label-policy";
import { composeBadgePrintSvg } from "../../../shared/badge-print-svg";
import {
  BADGE_LABEL_BATCH_SIZE,
  badgeLabelBatchResponseSchema,
  type BadgeLabelBatchRequest,
  type BadgeLabelBatchResponse,
} from "../../../shared/schemas/event-badge-label-batches";
import { badgePrintingResponseSchema } from "../../../shared/schemas/route-contracts-event-badges";
import { getJson, postJson } from "../../shared/api-client";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/PageHeader";
import { ErrorAlert } from "../ErrorAlert";
import { BadgePrintPreview } from "./BadgePrintPreview";
import type { PrintableBadgePrint } from "./badge-print-artifacts";
import { loadBadgePrintPopulation, type BadgePrintScope, type BadgePrintPopulationRow } from "./badge-print-population";

/** One compact data request per 1000 attendees. HTML/SVG rendering stays entirely in the browser. */
export function RegistrationBadgePrinting({
  slug,
  eventId,
  scope,
  isCurrent,
  onBack,
}: {
  slug: string;
  eventId: string;
  scope: BadgePrintScope;
  isCurrent: () => boolean;
  onBack: () => void;
}) {
  const [printed, setPrinted] = useState<PrintableBadgePrint[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const requests = useRef<BadgeLabelBatchRequest[]>([]);
  const responses = useRef<BadgeLabelBatchResponse[]>([]);
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges`;
  const requireCurrent = useCallback(() => {
    if (!active.current || !isCurrent()) throw new Error("Sign in again before printing these badges.");
  }, [isCurrent]);
  function validateBatch(
    response: BadgeLabelBatchResponse,
    request: BadgeLabelBatchRequest,
    rows: readonly BadgePrintPopulationRow[],
  ) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (
      response.operationId !== request.operationId ||
      response.labels.length !== request.registrationIds.length ||
      new Set(response.labels.map((row) => row.id)).size !== response.labels.length ||
      response.labels.some(
        (label, index) =>
          label.registrationId !== request.registrationIds[index] ||
          byId.get(label.registrationId)?.user_id !== label.userId ||
          Date.parse(label.expiresAt) <= Date.now(),
      )
    )
      throw new Error("The selected badges changed. Reload the print document.");
  }
  useEffect(() => {
    requests.current = [];
    responses.current = [];
  }, [scope, eventId, slug]);
  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    setBusy(true);
    setError("");
    setPrinted([]);
    void (async () => {
      try {
        const rows = await loadBadgePrintPopulation(scope, controller.signal, () => {});
        if (controller.signal.aborted) return;
        requireCurrent();
        if (!requests.current.length) {
          for (let offset = 0; offset < rows.length; offset += BADGE_LABEL_BATCH_SIZE)
            requests.current.push({
              operationId: crypto.randomUUID(),
              registrationIds: rows.slice(offset, offset + BADGE_LABEL_BATCH_SIZE).map((row) => row.id),
            });
        } else if (
          JSON.stringify(requests.current.flatMap((request) => request.registrationIds)) !==
          JSON.stringify(rows.map((row) => row.id))
        ) {
          throw new Error("The matching registrations changed. Return to registrations before printing.");
        }
        const prepared: BadgeLabelBatchResponse[] = [];
        for (const request of requests.current) {
          const response = await postJson(`${endpoint}/labels/batches`, request, badgeLabelBatchResponseSchema);
          if (controller.signal.aborted) return;
          requireCurrent();
          validateBatch(response, request, rows);
          prepared.push(response);
        }
        const badges = await Promise.all(
          prepared
            .flatMap((batch) => batch.labels)
            .map(async (label) => ({
              ...label,
              displayName: label.displayName ?? "Attendee name unavailable",
              svg: composeBadgePrintSvg(
                await QRCode.toString(label.credential, { type: "svg", errorCorrectionLevel: "M", margin: 4 }),
                label.credential,
              ),
            })),
        );
        if (controller.signal.aborted) return;
        requireCurrent();
        responses.current = prepared;
        setPrinted(badges);
      } catch (cause) {
        if (!controller.signal.aborted) {
          responses.current = [];
          setError(cause instanceof Error ? cause.message : "Could not load selected labels.");
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => {
      active.current = false;
      controller.abort();
      responses.current = [];
    };
  }, [scope, eventId, slug, retry, endpoint, requireCurrent]);

  async function beforeRelease() {
    try {
      requireCurrent();
      const expected = responses.current;
      const pending = requests.current;
      if (!expected.length || expected.length !== pending.length) throw new Error("Reload labels before printing.");
      for (let index = 0; index < pending.length; index++) {
        const current = await postJson(`${endpoint}/labels/batches`, pending[index], badgeLabelBatchResponseSchema);
        requireCurrent();
        if (responses.current !== expected || JSON.stringify(current) !== JSON.stringify(expected[index]))
          throw new Error("The attendee details or badge codes changed. Reload the print document.");
      }
      return true;
    } catch (cause) {
      responses.current = [];
      if (active.current) {
        setPrinted([]);
        setError(cause instanceof Error ? cause.message : "Could not check badge printing access.");
      }
      return false;
    }
  }
  return (
    <div class="pk-stack">
      <PageHeader
        title={scope.kind === "selected" ? "Print selected badges or labels" : "Print matching badges or labels"}
      />
      {busy && <p role="status">Loading labels…</p>}
      {error && <ErrorAlert error={error} />}
      {!busy && !error && !printed.length && <p>No matching registrations to print.</p>}

      <div class="pk-cluster">
        {error && (
          <Button disabled={busy} onClick={() => setRetry((value) => value + 1)}>
            Reload labels
          </Button>
        )}
        <Button onClick={onBack}>Back to registrations</Button>
      </div>
      {printed.length > 0 && (
        <BadgePrintPreview
          badges={printed}
          printing={BADGE_LABEL_PRINTING_CONTEXT}
          beforeRelease={beforeRelease}
          loadPrintingContext={() => getJson(`${endpoint}/printing`, badgePrintingResponseSchema)}
        />
      )}
    </div>
  );
}
