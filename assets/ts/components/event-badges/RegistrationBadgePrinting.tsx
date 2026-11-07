import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";
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
import { BadgeOutputProgress } from "./BadgeOutputProgress";
import { formatNumber } from "../../../shared/format-number";
import { BadgePrintCommand } from "./BadgePrintCommand";
import { ErrorAlert } from "../ErrorAlert";
import { BadgePrintPreview } from "./BadgePrintPreview";
import type { PrintableBadgePrint } from "./badge-print-artifacts";
import { loadBadgePrintPopulation, type BadgePrintScope, type BadgePrintPopulationRow } from "./badge-print-population";

/** Compact data batches; only visual output generates QR artwork. */
export function RegistrationBadgePrinting({
  slug,
  eventId,
  scope,
  action = "preview",
  isCurrent,
  onBack,
}: {
  slug: string;
  eventId: string;
  scope: BadgePrintScope;
  action?: BadgePrintAction;
  isCurrent: () => boolean;
  onBack: () => void;
}) {
  const [printed, setPrinted] = useState<PrintableBadgePrint[]>([]);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState("Finding attendees…");
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
        const rows = await loadBadgePrintPopulation(scope, controller.signal, (count) =>
          setProgress(`Finding attendees… ${formatNumber(count)} found`),
        );
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
          setProgress(
            `Preparing attendee data… ${formatNumber(prepared.reduce((count, batch) => count + batch.labels.length, 0))} of ${formatNumber(rows.length)}`,
          );
        }
        const labels = prepared.flatMap((batch) => batch.labels);
        const badges: PrintableBadgePrint[] = [];
        for (let index = 0; index < labels.length; index++) {
          const label = labels[index];
          badges.push({
            ...label,
            displayName: label.displayName ?? "Attendee name unavailable",
            svg:
              action === "label_csv" || action === "labels" || action === "label_pdf"
                ? ""
                : composeBadgePrintSvg(
                    await QRCode.toString(label.credential, { type: "svg", errorCorrectionLevel: "M", margin: 4 }),
                    label.credential,
                  ),
          });
          if ((action === "preview" || action === "badges" || action === "badge_pdf") && (index + 1) % 50 === 0) {
            setProgress(`Preparing artwork… ${formatNumber(index + 1)} of ${formatNumber(labels.length)}`);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (controller.signal.aborted) return;
            requireCurrent();
          }
        }
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
  }, [scope, eventId, slug, retry, endpoint, requireCurrent, action]);

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
  const title =
    action === "label_csv"
      ? "Download labels CSV"
      : action === "label_pdf"
        ? "Download labels PDF"
        : action === "badge_pdf"
          ? "Download badges PDF"
          : action === "badges"
            ? "Print badges"
            : "Print labels";
  const output =
    !error &&
    printed.length > 0 &&
    (action === "preview" ? (
      <BadgePrintPreview
        badges={printed}
        printing={BADGE_LABEL_PRINTING_CONTEXT}
        beforeRelease={beforeRelease}
        loadPrintingContext={() => getJson(`${endpoint}/printing`, badgePrintingResponseSchema)}
      />
    ) : (
      <BadgePrintCommand
        assertCurrent={requireCurrent}
        badges={printed}
        action={action}
        beforeRelease={beforeRelease}
        loadPrintingContext={() => getJson(`${endpoint}/printing`, badgePrintingResponseSchema)}
        onProgress={setProgress}
        onComplete={onBack}
        onError={setError}
      />
    ));
  if (action === "preview")
    return (
      <div class="pk-stack">
        {error && (
          <>
            <ErrorAlert error={error} />
            <Button onClick={() => setRetry((value) => value + 1)}>Reload labels</Button>
          </>
        )}
        {output}
      </div>
    );
  return (
    <BadgeOutputProgress
      title={title}
      progress={progress}
      error={error}
      empty={!busy && !printed.length}
      onRetry={() => setRetry((value) => value + 1)}
      onClose={onBack}
    >
      {output}
    </BadgeOutputProgress>
  );
}
