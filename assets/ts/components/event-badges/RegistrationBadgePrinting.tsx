import { BADGE_LABEL_PRINTING_CONTEXT } from "../../../shared/badge-label-policy";
import type { z } from "zod";
import { verifyBadgeLabelArtifact } from "./badge-print-context";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  badgePrintingResponseSchema,
  type BadgeIssueResponse,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgeLabelRequestSchema,
  badgePrintResponseSchema,
  badgeCredentialMetadataSchema,
  type BadgeIssueRequest,
  type BadgeLabelRequest,
} from "../../../shared/schemas/route-contracts-event-badges";
import { formatNumber } from "../../../shared/format-number";
import { ApiClientError, getJson, postJson } from "../../shared/api-client";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/PageHeader";
import { ErrorAlert } from "../ErrorAlert";
import { BadgePrintPreview } from "./BadgePrintPreview";
import type { PrintableBadgePrint } from "./badge-print-artifacts";
import { loadBadgePrintPopulation, type BadgePrintScope, type BadgePrintPopulationRow } from "./badge-print-population";

/** Explicit population selection, with stable per-attendee retry receipts. */
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
  const [requests, setRequests] = useState<
    Array<{ row: BadgePrintPopulationRow; request: BadgeIssueRequest; printOperationId: string }>
  >([]);
  const printing = BADGE_LABEL_PRINTING_CONTEXT;
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState(0);
  const active = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    setLoading(true);
    setLoadError("");
    setProgress(0);
    void loadBadgePrintPopulation(scope, controller.signal, (count) => {
      if (!controller.signal.aborted) setProgress(count);
    })
      .then((rows) => {
        if (controller.signal.aborted) return;
        requireCurrent();
        setRequests(
          rows.map((row) => ({
            row,
            // An attendee who already holds an active badge (organizer-issued or shown on their phone ticket)
            // gets that badge reprinted, so every copy carries one code.
            request: badgeIssueRequestSchema.parse({
              operationId: crypto.randomUUID(),
              userId: row.user_id,
              reuseActive: true,
            }),
            printOperationId: crypto.randomUUID(),
          })),
        );
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(cause instanceof Error ? cause.message : "Could not load matching registrations.");
        setLoading(false);
      });
    return () => {
      active.current = false;
      controller.abort();
      issued.current.clear();
      recovered.current.clear();
    };
  }, [scope, loadAttempt]);
  const issued = useRef(new Map<string, BadgeIssueResponse>());
  const recovered = useRef(
    new Map<string, { print: z.infer<typeof badgePrintResponseSchema>; request: BadgeLabelRequest }>(),
  );
  const [printed, setPrinted] = useState<PrintableBadgePrint[]>([]);
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const badgeEndpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges`;
  function requireCurrent() {
    if (!active.current || !isCurrent()) throw new Error("Sign in again before printing these badges.");
  }
  function discardArtifacts(clearIssued = true) {
    recovered.current.clear();
    if (clearIssued) issued.current.clear();
    if (active.current) setPrinted([]);
  }
  async function beforeRelease() {
    try {
      if (!printing) return false;
      requireCurrent();
      for (const prepared of recovered.current.values()) {
        requireCurrent();
        await verifyBadgeLabelArtifact(badgeEndpoint, prepared.print, prepared.request);
        requireCurrent();
      }
      requireCurrent();
      return true;
    } catch (cause) {
      discardArtifacts(!isCurrent());
      if (active.current) {
        setError(cause instanceof Error ? cause.message : "Could not check recovered badge printing access.");
      }
      return false;
    }
  }
  async function reloadPrintDocument() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      requireCurrent();
      setPrinted([]);
      setCompleted(new Set());
      recovered.current.clear();
      setRequests((previous) =>
        previous.map((item) => ({
          ...item,
          printOperationId: crypto.randomUUID(),
        })),
      );
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Could not reload the print document.");
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function create() {
    if (running.current || loading || loadError || !requests.length) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      requireCurrent();
      for (const { row, request, printOperationId } of requests) {
        requireCurrent();
        if (completed.has(row.id)) continue;
        let issuance = issued.current.get(row.id);
        if (!issuance) {
          issuance = await postJson(badgeEndpoint, request, badgeIssueResponseSchema);
          requireCurrent();
          issued.current.set(row.id, issuance);
        }
        const printRequest = badgeLabelRequestSchema.parse({
          source: "badge",
          badgeId: issuance.id,
          operationId: printOperationId,
        });
        const print = await postJson(`${badgeEndpoint}/labels`, printRequest, badgePrintResponseSchema);
        requireCurrent();
        const metadata = await getJson(
          `${badgeEndpoint}/${encodeURIComponent(issuance.id)}`,
          badgeCredentialMetadataSchema,
        );
        requireCurrent();
        if (
          print.id !== issuance.id ||
          metadata.id !== issuance.id ||
          metadata.userId !== request.userId ||
          print.expiresAt !== issuance.expiresAt ||
          print.expiresAt !== metadata.expiresAt ||
          print.displayName !== metadata.displayName ||
          print.printingRevision !== printing?.revision
        ) {
          discardArtifacts();
          throw new Error("The issued badge changed. Open its record before printing.");
        }
        if (
          metadata.eventId !== eventId ||
          metadata.status !== "active" ||
          !metadata.reprintAvailable ||
          Date.parse(print.expiresAt) <= Date.now()
        )
          throw new Error("This badge is no longer available for printing.");
        recovered.current.set(issuance.id, { print, request: printRequest });
        setCompleted((previous) => new Set([...previous, row.id]));
      }
    } catch (cause) {
      if (!isCurrent() || (cause instanceof ApiClientError && (cause.status === 401 || cause.status === 403)))
        discardArtifacts();
      if (active.current)
        setError(
          `${issued.current.size > completed.size ? "Some badges were issued, but their print files are not ready. Retry keeps those badges. " : ""}${cause instanceof Error ? cause.message : "Could not prepare selected badges."}`,
        );
    } finally {
      running.current = false;
      if (active.current) {
        setBusy(false);
        // Publish once per run so a large batch does not rebuild every preceding label after each response.
        setPrinted(
          requests.flatMap(({ row }) => {
            const issuance = issued.current.get(row.id);
            const print = issuance ? recovered.current.get(issuance.id)?.print : null;
            return print && issuance
              ? [
                  {
                    ...print,
                    displayName: print.displayName ?? "Attendee name unavailable",
                    ...(issuance.result === "issued" ? { credential: issuance.credential } : {}),
                  },
                ]
              : [];
          }),
        );
      }
    }
  }
  useEffect(() => {
    if (!loading && !loadError && requests.length) void create();
  }, [loading, requests]);
  return (
    <div class="pk-stack">
      <PageHeader
        title={scope.kind === "selected" ? "Print selected badges or labels" : "Print matching badges or labels"}
      />
      <p>
        Use the print preview for labels, full badges, or a printing CSV with QR codes. Existing badge codes are reused;
        attendees without a badge receive one.
      </p>
      {loading && <p role="status">Loading matching registrations… {formatNumber(progress)} found.</p>}
      {loadError && <ErrorAlert error={loadError} />}
      {!loading && !loadError && !requests.length && <p>No matching registrations to print.</p>}
      <p>
        {formatNumber(completed.size)} of {formatNumber(requests.length)} requests completed.
      </p>
      {error && (
        <>
          <ErrorAlert error={error} />
          <Button disabled={busy} onClick={() => void reloadPrintDocument()}>
            Prepare new print document
          </Button>
        </>
      )}
      <div class="pk-cluster">
        {loadError ? (
          <Button onClick={() => setLoadAttempt((previous) => previous + 1)}>Retry loading registrations</Button>
        ) : error ? (
          <Button
            loading={busy}
            disabled={loading || !requests.length || completed.size === requests.length}
            onClick={() => void create()}
          >
            Retry remaining requests
          </Button>
        ) : null}
        <Button disabled={busy} onClick={onBack}>
          Back to badges
        </Button>
      </div>
      {printed.length > 0 && printing && (
        <BadgePrintPreview
          badges={printed}
          printing={printing}
          beforeRelease={beforeRelease}
          loadPrintingContext={() => getJson(`${badgeEndpoint}/printing`, badgePrintingResponseSchema)}
        />
      )}
    </div>
  );
}
