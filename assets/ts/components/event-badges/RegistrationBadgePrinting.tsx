import { useEffect, useRef, useState } from "preact/hooks";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
  badgeCredentialMetadataSchema,
  type BadgeIssueRequest,
  type BadgePrintRequest,
  type BadgeCredentialMetadata,
} from "../../../shared/schemas/route-contracts-event-badges";
import { formatNumber } from "../../../shared/format-number";
import { ApiClientError, getJson, postJson } from "../../shared/api-client";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { PageHeader } from "../../ui/PageHeader";
import { ErrorAlert } from "../ErrorAlert";
import { BadgePrintPreview } from "./BadgePrintPreview";
import type { FreshBadgePrint, PrintableBadgePrint } from "./badge-print-artifacts";
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
        setRequests(
          rows.map((row) => ({
            row,
            request: badgeIssueRequestSchema.parse({ operationId: crypto.randomUUID(), userId: row.user_id }),
            printRequest: badgePrintRequestSchema.parse({ operationId: crypto.randomUUID() }),
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
  const issued = useRef(new Map<string, Omit<FreshBadgePrint, "svg">>());
  const recovered = useRef(new Map<string, BadgeCredentialMetadata>());
  const [printed, setPrinted] = useState<PrintableBadgePrint[]>([]);
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const badgeEndpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges`;
  function requireCurrent() {
    if (!active.current || !isCurrent()) throw new Error("Sign in again before printing these badges.");
  }
  async function verifyRecovered(expected: BadgeCredentialMetadata) {
    requireCurrent();
    const metadata = await getJson(
      `${badgeEndpoint}/${encodeURIComponent(expected.id)}`,
      badgeCredentialMetadataSchema,
    );
    requireCurrent();
    if (
      metadata.eventId !== eventId ||
      metadata.id !== expected.id ||
      metadata.eventId !== expected.eventId ||
      metadata.userId !== expected.userId ||
      metadata.status !== "active" ||
      !metadata.reprintAvailable ||
      metadata.expiresAt !== expected.expiresAt ||
      metadata.displayName !== expected.displayName ||
      !metadata.expiresAt ||
      Date.parse(metadata.expiresAt) <= Date.now()
    )
      throw new Error("A recovered badge changed or is no longer available for printing. Open its record again.");
  }
  function discardArtifacts() {
    recovered.current.clear();
    issued.current.clear();
    if (active.current) setPrinted([]);
  }
  async function beforeRelease() {
    try {
      for (const metadata of recovered.current.values()) await verifyRecovered(metadata);
      requireCurrent();
      return true;
    } catch (cause) {
      discardArtifacts();
      if (active.current) {
        setError(cause instanceof Error ? cause.message : "Could not check recovered badge printing access.");
      }
      return false;
    }
  }
  async function create() {
    if (running.current || loading || loadError || !requests.length) return;
    running.current = true;
    setBusy(true);
    if (
      completed.size === 0 &&
      !(await confirmAction({
        title:
          scope.kind === "selected"
            ? "Create badges for selected registrations?"
            : "Create badges for all matching registrations?",
        body: `Create ${formatNumber(requests.length)} additional credentials. Existing badges remain valid. Save the print files before leaving this page.`,
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
      const { default: QR } = await import("qrcode");
      for (const { row, request, printRequest } of requests) {
        if (!active.current) break;
        requireCurrent();
        if (completed.has(row.id)) continue;
        let fresh = issued.current.get(row.id);
        if (!fresh) {
          const result = await postJson(badgeEndpoint, request, badgeIssueResponseSchema);
          requireCurrent();
          if (result.result === "replayed") {
            requireCurrent();
            const print = await postJson(
              `${badgeEndpoint}/${encodeURIComponent(result.id)}/print`,
              printRequest,
              badgePrintResponseSchema,
            );
            if (!active.current) return;
            const metadata = await getJson(
              `${badgeEndpoint}/${encodeURIComponent(result.id)}`,
              badgeCredentialMetadataSchema,
            );
            if (
              print.id !== result.id ||
              metadata.id !== result.id ||
              metadata.userId !== request.userId ||
              print.expiresAt !== result.expiresAt ||
              print.expiresAt !== metadata.expiresAt ||
              print.displayName !== metadata.displayName
            ) {
              discardArtifacts();
              throw new Error("The completed badge changed. Open its record before printing.");
            }
            await verifyRecovered(metadata);
            recovered.current.set(result.id, metadata);
            setPrinted((previous) => [
              ...previous,
              { id: print.id, svg: print.svg, displayName: print.displayName ?? "Attendee" },
            ]);
            setCompleted((previous) => new Set([...previous, row.id]));
            continue;
          }
          fresh = { id: result.id, credential: result.credential, displayName: row.display_name ?? "Attendee" };
          issued.current.set(row.id, fresh);
        }
        const svg = await QR.toString(fresh.credential, { type: "svg", errorCorrectionLevel: "M", margin: 4 });
        requireCurrent();
        const printable = { ...fresh, svg };
        setPrinted((previous) => [...previous, printable]);
        setCompleted((previous) => new Set([...previous, row.id]));
      }
    } catch (cause) {
      if (!isCurrent() || (cause instanceof ApiClientError && (cause.status === 401 || cause.status === 403)))
        discardArtifacts();
      if (active.current) setError(cause instanceof Error ? cause.message : "Could not create selected badges.");
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
        Each attendee receives an additional credential; existing badges remain valid. A completed request can recover
        its original print file when available.
      </p>
      {loading && <p role="status">Loading matching registrations… {formatNumber(progress)} found.</p>}
      {loadError && <ErrorAlert error={loadError} />}
      {!loading && !loadError && !requests.length && <p>No matching registrations to print.</p>}
      <p>
        {formatNumber(completed.size)} of {formatNumber(requests.length)} requests completed.
      </p>
      {recovered.current.size > 0 && (
        <Alert tone="info">
          {formatNumber(recovered.current.size)} completed badge print files were recovered without replacing their
          credentials. Printing CSV is available only when all original codes were returned during this session.
        </Alert>
      )}
      {error && <ErrorAlert error={error} />}
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
          Back to registrations
        </Button>
      </div>
      {printed.length > 0 && (
        <BadgePrintPreview badges={printed} beforeRelease={recovered.current.size ? beforeRelease : undefined} />
      )}
    </div>
  );
}
