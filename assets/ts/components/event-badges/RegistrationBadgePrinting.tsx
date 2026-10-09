import type { z } from "zod";
import { verifyBadgePrintingContext, verifyBadgePrintArtifact } from "./badge-print-context";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  badgePrintingResponseSchema,
  type BadgePrintingContext,
  type BadgeIssueResponse,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
  badgeCredentialMetadataSchema,
  type BadgeIssueRequest,
  type BadgePrintRequest,
} from "../../../shared/schemas/route-contracts-event-badges";
import { formatNumber } from "../../../shared/format-number";
import { ApiClientError, getJson, postJson } from "../../shared/api-client";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
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
    Array<{ row: BadgePrintPopulationRow; request: BadgeIssueRequest; printRequest: BadgePrintRequest }>
  >([]);
  const [printing, setPrinting] = useState<BadgePrintingContext | null>(null);
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
    void Promise.all([
      getJson(`/api/v1/events/${encodeURIComponent(slug)}/badges/printing`, badgePrintingResponseSchema, {
        signal: controller.signal,
      }),
      loadBadgePrintPopulation(scope, controller.signal, (count) => {
        if (!controller.signal.aborted) setProgress(count);
      }),
    ])
      .then(([context, rows]) => {
        if (controller.signal.aborted) return;
        requireCurrent();
        setPrinting(context);
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
            printRequest: badgePrintRequestSchema.parse({
              operationId: crypto.randomUUID(),
              printingRevision: context.revision,
            }),
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
    new Map<string, { print: z.infer<typeof badgePrintResponseSchema>; request: BadgePrintRequest }>(),
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
      await verifyBadgePrintingContext(badgeEndpoint, printing);
      for (const prepared of recovered.current.values()) {
        requireCurrent();
        await verifyBadgePrintArtifact(badgeEndpoint, prepared.print, prepared.request);
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
      const context = await getJson(`${badgeEndpoint}/printing`, badgePrintingResponseSchema);
      requireCurrent();
      setPrinting(context);
      setPrinted([]);
      setCompleted(new Set());
      recovered.current.clear();
      setRequests((previous) =>
        previous.map((item) => ({
          ...item,
          printRequest: badgePrintRequestSchema.parse({
            operationId: crypto.randomUUID(),
            printingRevision: context.revision,
          }),
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
    if (
      completed.size === 0 &&
      issued.current.size === 0 &&
      !(await confirmAction({
        title:
          scope.kind === "selected"
            ? "Create badges for selected registrations?"
            : "Create badges for all matching registrations?",
        body: `Prepare badges for ${formatNumber(requests.length)} registrations. An attendee with an active badge gets that badge reprinted; the others receive one new credential. Save the print files before leaving this page.`,
        confirmLabel: scope.kind === "selected" ? "Create selected badges" : "Create all matching badges",
      }))
    ) {
      setBusy(false);
      running.current = false;
      return;
    }
    setError("");
    try {
      requireCurrent();
      for (const { row, request, printRequest } of requests) {
        requireCurrent();
        if (completed.has(row.id)) continue;
        let issuance = issued.current.get(row.id);
        if (!issuance) {
          issuance = await postJson(badgeEndpoint, request, badgeIssueResponseSchema);
          requireCurrent();
          issued.current.set(row.id, issuance);
        }
        const print = await postJson(
          `${badgeEndpoint}/${encodeURIComponent(issuance.id)}/print`,
          printRequest,
          badgePrintResponseSchema,
        );
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
        const printable = {
          ...print,
          displayName: print.displayName ?? "Attendee name unavailable",
          ...(issuance.result === "issued" ? { credential: issuance.credential } : {}),
        };
        setPrinted((previous) => [...previous, printable]);
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
      if (active.current) setBusy(false);
    }
  }
  return (
    <div class="pk-stack">
      <PageHeader
        title={scope.kind === "selected" ? "Print selected attendee badges" : "Print all matching attendee badges"}
      />
      <p>
        {scope.kind === "selected"
          ? "Scope: selected registrations on the loaded page."
          : "Scope: all matching active, registered attendees across every result page, using the captured search and filters."}{" "}
        An attendee who already holds an active badge gets that same badge reprinted, so the printed code matches the
        ticket on their phone; the others receive one new credential. A completed request can recover its print file.
      </p>
      {loading && <p role="status">Loading matching registrations… {formatNumber(progress)} found.</p>}
      {loadError && <ErrorAlert error={loadError} />}
      {!loading && !loadError && !requests.length && <p>No matching registrations to print.</p>}
      <p>
        {formatNumber(completed.size)} of {formatNumber(requests.length)} requests completed.
      </p>
      {printed.some((badge) => !("credential" in badge)) && (
        <Alert tone="info">
          {formatNumber(printed.filter((badge) => !("credential" in badge)).length)} completed badge print files were
          recovered without replacing their credentials. Printing CSV is available only when all original codes were
          returned during this session.
        </Alert>
      )}
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
        ) : (
          <Button
            loading={busy}
            disabled={loading || !requests.length || completed.size === requests.length}
            onClick={() => void create()}
          >
            {completed.size
              ? "Retry remaining requests"
              : scope.kind === "selected"
                ? "Create selected badges"
                : "Create all matching badges"}
          </Button>
        )}
        <Button disabled={busy} onClick={onBack}>
          Back to badges
        </Button>
      </div>
      {printed.length > 0 && printing && (
        <BadgePrintPreview badges={printed} printing={printing} beforeRelease={beforeRelease} />
      )}
    </div>
  );
}
