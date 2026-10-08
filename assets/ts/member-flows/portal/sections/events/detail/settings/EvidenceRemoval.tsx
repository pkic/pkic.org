import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  EVIDENCE_PURGE_TABLES,
  evidencePurgePreviewSchema,
  evidencePurgeReviewCreateSchema,
  evidencePurgeReviewResponseSchema,
  evidencePurgeRunCreateSchema,
  evidencePurgeResumptionCreateSchema,
  evidencePurgeRunResponseSchema,
  evidencePurgeChunkCreateSchema,
  evidencePurgeChunkResponseSchema,
} from "../../../../../../../shared/schemas/event-evidence-purge";
import { getJson, postJson } from "../../../../../../shared/api-client";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { DataTable } from "../../../../../../ui/DataTable";
import { StatCard } from "../../../../../../ui/StatCard";
import { Badge } from "../../../../../../ui/Badge";
import { formatNumber } from "../../../../../../../shared/format-number";

type Preview = z.infer<typeof evidencePurgePreviewSchema>;
type Review = z.infer<typeof evidencePurgeReviewResponseSchema>;
type Run = z.infer<typeof evidencePurgeRunResponseSchema>;
const blockerLabels: Record<Preview["blockers"][number], string> = {
  policy_unconfigured: "Set an explicit evidence retention deadline first.",
  cutoff_not_due: "The evidence retention deadline has not passed.",
  removal_paused: "Evidence removal is paused by the retention policy.",
  contact_open: "Contact access must close before evidence removal.",
  device_reconciliation_incomplete: "Finish scanner sessions and reconcile their uploads and offline admission grants.",
  active_run: "An evidence removal run is already in progress.",
  already_purged: "Raw evidence has already been removed.",
};
const evidenceLabels: Record<(typeof EVIDENCE_PURGE_TABLES)[number], string> = {
  event_attendance_import_provenance: "Attendance import source links",
  event_attendance_corrections: "Attendance corrections",
  event_attendance_correction_state: "Attendance correction state",
  event_attendance_observations: "Attendance observations",
  event_attendance_imports: "Attendance imports",
  event_attendance_import_reviews: "Attendance import reviews",
  event_sponsor_leads: "Sponsor leads",
  event_scan_attempts: "Scan attempts",
  event_offline_admission_access: "Offline admission access records",
  event_offline_admission_entitlements: "Offline admission eligibility records",
  event_offline_admission_spends: "Offline admission uses",
  event_offline_admission_grants: "Offline admission grants",
  event_entry_admissions: "Event entry admissions",
  event_session_admissions: "Session admissions",
  event_badge_credentials: "Badge credentials",
  event_scanner_upload_receipts: "Scanner upload receipts",
  event_scanner_device_sessions: "Scanner sessions",
};
/** Starting retirement is explicit; each subsequent step is bounded and retryable. */
export function EvidenceRemoval({ eventId, canRemove }: { eventId: string; canRemove: boolean }) {
  const endpoint = `/api/v1/retention/events/${encodeURIComponent(eventId)}`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewOperation, setReviewOperation] = useState(() => crypto.randomUUID());
  const [runOperation, setRunOperation] = useState(() => crypto.randomUUID());
  const [stepOperation, setStepOperation] = useState(() => crypto.randomUUID());
  const pendingStep = useRef<(z.infer<typeof evidencePurgeChunkCreateSchema> & { runId: string }) | null>(null);
  const paused = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    pendingStep.current = null;
    return () => {
      mounted.current = false;
      paused.current = true;
    };
  }, [eventId]);
  const form = useContractForm(evidencePurgeRunCreateSchema, {
    operationId: runOperation,
    reviewId: review?.reviewId,
    reviewHash: review?.reviewHash,
    retireCapture: confirmed,
  });
  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      const current = await getJson(`${endpoint}/evidence`, evidencePurgePreviewSchema);
      setPreview(current);
      setReview(null);
      setConfirmed(false);
      setReviewOperation(crypto.randomUUID());
      if (current.activeRunId)
        setRun(await getJson(`${endpoint}/runs/${current.activeRunId}`, evidencePurgeRunResponseSchema));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Removal readiness is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [eventId]);
  async function recordReview() {
    if (!preview || !canRemove || busy) return;
    setBusy(true);
    setMessage("");
    try {
      setReview(
        await postJson(
          run?.reviewRequired ? `${endpoint}/runs/${run.runId}/reviews` : `${endpoint}/reviews`,
          evidencePurgeReviewCreateSchema.parse({
            operationId: reviewOperation,
            expectedPreviewHash: preview.previewHash,
            expectedPolicyRevision: preview.policyRevision,
            expectedGeneration: preview.sourceGeneration,
          }),
          evidencePurgeReviewResponseSchema,
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Review could not be recorded. Refresh readiness before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function start(event: Event) {
    event.preventDefault();
    if (!canRemove || busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setMessage(checked.message);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      setRun(await postJson(`${endpoint}/runs`, checked.data, evidencePurgeRunResponseSchema));
      setRunOperation(crypto.randomUUID());
    } catch (error) {
      setMessage(form.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  const resumption = useContractForm(evidencePurgeResumptionCreateSchema, {
    operationId: runOperation,
    reviewId: review?.reviewId,
    reviewHash: review?.reviewHash,
  });
  async function resume(event: Event) {
    event.preventDefault();
    if (!run || !canRemove || busy) return;
    const checked = resumption.submit();
    if (!checked.data) {
      setMessage(checked.message);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      setRun(await postJson(`${endpoint}/runs/${run.runId}/resumptions`, checked.data, evidencePurgeRunResponseSchema));
      setReview(null);
      setRunOperation(crypto.randomUUID());
    } catch (error) {
      setMessage(resumption.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  async function step() {
    if (!run || !canRemove || busy || run.status === "complete" || run.reviewRequired) return;
    setBusy(true);
    setMessage("");
    paused.current = false;
    let current = run;
    let operationId = stepOperation;
    try {
      // Keep one operator action bounded; every server chunk has its own durable receipt.
      for (let index = 0; index < 25 && mounted.current && !paused.current && current.status !== "complete"; index++) {
        const request = pendingStep.current ?? { runId: current.runId, operationId, expectedOrdinal: current.ordinal };
        if (request.runId !== current.runId) throw new Error("Reload the removal run before continuing.");
        pendingStep.current = request;
        const receipt = await postJson(
          `${endpoint}/runs/${current.runId}/chunks`,
          evidencePurgeChunkCreateSchema.parse({
            operationId: request.operationId,
            expectedOrdinal: request.expectedOrdinal,
          }),
          evidencePurgeChunkResponseSchema,
        );
        pendingStep.current = null;
        if (receipt.ordinal >= current.ordinal)
          current = { ...current, ordinal: receipt.ordinal, sourceGeneration: receipt.sourceGenerationAfter };
        operationId = crypto.randomUUID();
        if (!mounted.current) return;
        setRun(current);
        setStepOperation(operationId);
        current = await getJson(`${endpoint}/runs/${current.runId}`, evidencePurgeRunResponseSchema);
        if (mounted.current) setRun(current);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "This step could not be confirmed. Retry preserves its operation ID.",
      );
    } finally {
      setBusy(false);
    }
  }
  const evidence = review ?? preview;
  return (
    <Panel aria-label="Reviewed evidence removal">
      <PanelHeader title="Reviewed evidence removal">
        <Button size="sm" disabled={busy} onClick={() => void refresh()}>
          Refresh removal status
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <p>
          Keep aggregate attendance reports while removing raw scan, attendance, and sponsor lead evidence. Starting
          removal permanently retires badge capture for this event.
        </p>
        {busy && run && (
          <Button
            size="sm"
            onClick={() => {
              paused.current = true;
            }}
          >
            Pause after this step
          </Button>
        )}
        {message && <Alert tone="danger">{message}</Alert>}
        {!preview && <Alert>Loading removal readiness…</Alert>}
        {preview && evidence && (
          <>
            <div class="pk-stat-row">
              <StatCard
                label="Attendance observations"
                value={formatNumber(evidence.counts.event_attendance_observations)}
              />
              <StatCard label="Scan attempts" value={formatNumber(evidence.counts.event_scan_attempts)} />
              <StatCard label="Sponsor leads" value={formatNumber(evidence.counts.event_sponsor_leads)} />
            </div>
            <p>
              Scanner upload status{" "}
              <Badge
                tone={
                  (run?.reconciliation ?? evidence.reconciliation).deviceBacklog === "complete"
                    ? "ok"
                    : (run?.reconciliation ?? evidence.reconciliation).deviceBacklog === "pending"
                      ? "warn"
                      : "neutral"
                }
              >
                {(run?.reconciliation ?? evidence.reconciliation).deviceBacklog}
              </Badge>
            </p>
            <Panel>
              <PanelHeader title="All evidence included in this review" />
              <DataTable
                narrowLayout="columns"
                caption="Evidence included in removal review"
                columns={[
                  { id: "category", header: "Evidence", width: "primary", cell: (table) => evidenceLabels[table] },
                  {
                    id: "count",
                    header: "Records",
                    align: "end",
                    width: "fit",
                    cell: (table) => formatNumber(evidence.counts[table]),
                  },
                ]}
                rows={EVIDENCE_PURGE_TABLES}
                rowKey={(table) => table}
              />
            </Panel>
            {preview.blockers
              .filter((blocker) => !run || (blocker !== "active_run" && blocker !== "device_reconciliation_incomplete"))
              .map((blocker) => (
                <Alert key={blocker} tone="warn">
                  {blockerLabels[blocker]}
                </Alert>
              ))}
            {!run && canRemove && preview.blockers.length === 0 && !review && (
              <Button disabled={busy} onClick={() => void recordReview()}>
                Review current evidence
              </Button>
            )}
            {run?.reviewRequired && canRemove && !review && (
              <>
                <Alert tone="warn">
                  The retention policy changed. Review the remaining evidence before continuing. Event capture stays
                  retired.
                </Alert>
                <Button disabled={busy} onClick={() => void recordReview()}>
                  Review policy change
                </Button>
              </>
            )}
            {review && run?.reviewRequired && canRemove && (
              <form noValidate {...resumption.handlers} onSubmit={resume}>
                <Button type="submit" disabled={busy}>
                  Resume reviewed removal
                </Button>
              </form>
            )}
            {review && !run && canRemove && (
              <form noValidate {...form.handlers} onSubmit={start} class="pk-stack">
                <Field label="Retire event capture" {...form.of("retireCapture")}>
                  {(control) => (
                    <Checkbox
                      {...control}
                      name="retireCapture"
                      checked={confirmed}
                      onInput={(event) => setConfirmed(event.currentTarget.checked)}
                      label="I reviewed these counts and understand that capture retirement and evidence removal cannot be undone."
                    />
                  )}
                </Field>
                <Button type="submit" disabled={busy}>
                  Retire capture and start removal
                </Button>
              </form>
            )}
          </>
        )}
        {run && (
          <>
            <Alert tone={run.status === "complete" ? "ok" : "info"}>
              {run.status === "complete"
                ? "Raw evidence removal is complete. Aggregate attendance reports remain available."
                : `Removal is in progress. ${formatNumber(run.ordinal)} steps committed.`}
            </Alert>
            {run.status !== "complete" && !run.reviewRequired && canRemove && (
              <Button disabled={busy} onClick={() => void step()}>
                Continue removal
              </Button>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
