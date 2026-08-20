import { useCallback, useEffect, useState } from "preact/hooks";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Spinner } from "../../components/Spinner";
import { api } from "../api";
import type { AdminJobsRunResponse } from "../types";
import { toast } from "../ui";
import { DueWorkTable } from "./due-work/DueWorkTable";
import { JobRunSummary } from "./due-work/JobRunSummary";

export function DueWork() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminderLimit, setReminderLimit] = useState(120);
  const [outboxLimit, setOutboxLimit] = useState(120);
  const [includeRetention, setIncludeRetention] = useState(false);
  const [preview, setPreview] = useState<AdminJobsRunResponse | null>(null);
  const [lastRun, setLastRun] = useState<AdminJobsRunResponse | null>(null);
  const [dueWorkRefreshKey, setDueWorkRefreshKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [runningMembershipBatch, setRunningMembershipBatch] = useState<
    "consultation" | "ecReview" | "wgChairDigest" | null
  >(null);

  const fetchPreview = useCallback(
    async (rl: number, ol: number, retention: boolean): Promise<AdminJobsRunResponse> => {
      return api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
        method: "POST",
        body: JSON.stringify({
          reminderLimit: rl,
          outboxLimit: ol,
          runReminders: true,
          runRetention: retention,
          runOutbox: true,
          runRetentionMode: "always",
          retentionHourUtc: 0,
          dryRun: true,
        }),
      });
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await fetchPreview(reminderLimit, outboxLimit, includeRetention));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reminderLimit, outboxLimit, includeRetention, fetchPreview]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doRunJobs(dryRun: boolean) {
    setRunning(true);
    try {
      const result = await api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
        method: "POST",
        body: JSON.stringify({
          reminderLimit,
          outboxLimit,
          runReminders: true,
          runRetention: includeRetention,
          runOutbox: true,
          runRetentionMode: "always",
          retentionHourUtc: 0,
          dryRun,
        }),
      });
      if (dryRun) {
        setPreview(result);
        toast("Preview refreshed", "info");
      } else {
        setLastRun(result);
        setDueWorkRefreshKey((value) => value + 1);
        toast(
          `Done: ${result.reminders.processed} reminders, ${result.outbox.processed} outbox rows${includeRetention ? `, ${result.retention.redactedRegistrations} data redacted` : ""}`,
          "success",
        );
        void load();
      }
    } catch (reason) {
      toast((reason as Error).message, "error");
    } finally {
      setRunning(false);
    }
  }

  /** Manual off-cycle trigger for the twice-weekly membership batches. */
  async function runMembershipBatch(kind: "consultation" | "ecReview" | "wgChairDigest") {
    setRunningMembershipBatch(kind);
    try {
      const result = await api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
        method: "POST",
        body: JSON.stringify({
          runReminders: false,
          runRetention: false,
          runOutbox: false,
          runConsultationBatch: kind === "consultation",
          runEcReviewBatch: kind === "ecReview",
          runWgChairDigest: kind === "wgChairDigest",
          dryRun: false,
        }),
      });
      if (kind === "consultation") {
        toast(`Consultation batch sent: ${result.consultationBatch.applicationsNotified} application(s)`, "success");
      } else if (kind === "ecReview") {
        toast(
          `EC review batch sent: ${result.ecReviewBatch.transitioned} application(s) moved to ec_review`,
          "success",
        );
      } else {
        toast(
          `WG chair digest sent: ${result.wgChairDigest.emailsSent} email(s) across ${result.wgChairDigest.workingGroupsWithChanges} working group(s) with changes`,
          "success",
        );
      }
    } catch (reason) {
      toast((reason as Error).message, "error");
    } finally {
      setRunningMembershipBatch(null);
    }
  }

  if (loading && !preview) return <Spinner />;
  if (error && !preview) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="action-card">
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">
          <strong>Due Work</strong>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-sm btn-outline-primary" onClick={() => void doRunJobs(true)} disabled={running}>
              Refresh Preview
            </button>
            <button class="btn btn-sm btn-primary" onClick={() => void doRunJobs(false)} disabled={running}>
              {running ? "Processing…" : "Process Due Work Now"}
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              onClick={() => void runMembershipBatch("consultation")}
              disabled={runningMembershipBatch !== null}
              title="Normally runs automatically Mon/Wed 07:15 UTC"
            >
              {runningMembershipBatch === "consultation" ? "Sending…" : "Send consultation batch now"}
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              onClick={() => void runMembershipBatch("ecReview")}
              disabled={runningMembershipBatch !== null}
              title="Normally runs automatically Mon/Wed 08:15 UTC"
            >
              {runningMembershipBatch === "ecReview" ? "Sending…" : "Send EC review batch now"}
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              onClick={() => void runMembershipBatch("wgChairDigest")}
              disabled={runningMembershipBatch !== null}
              title="Normally runs automatically Mondays 08:00 UTC"
            >
              {runningMembershipBatch === "wgChairDigest" ? "Sending…" : "Send WG chair digest now"}
            </button>
          </div>
        </div>

        <div class="border rounded p-2 mb-3 bg-light-subtle">
          <div class="d-flex flex-wrap align-items-center gap-3 small">
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <span class="text-muted">Reminders</span>
              <input
                type="number"
                class="form-control form-control-sm adm-due-work-limit"
                value={reminderLimit}
                min={1}
                max={500}
                onInput={(event) => setReminderLimit(Number((event.target as HTMLInputElement).value) || 120)}
              />
            </label>
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <span class="text-muted">Outbox</span>
              <input
                type="number"
                class="form-control form-control-sm adm-due-work-limit"
                value={outboxLimit}
                min={1}
                max={500}
                onInput={(event) => setOutboxLimit(Number((event.target as HTMLInputElement).value) || 120)}
              />
            </label>
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <input
                class="form-check-input mt-0"
                type="checkbox"
                checked={includeRetention}
                onChange={(event) => setIncludeRetention((event.target as HTMLInputElement).checked)}
              />
              <span class="text-muted">Cleanup</span>
            </label>
          </div>
        </div>

        <DueWorkTable
          reminderLimit={reminderLimit}
          outboxLimit={outboxLimit}
          includeRetention={includeRetention}
          refreshKey={dueWorkRefreshKey}
        />

        <div class="mt-4">
          {lastRun ? (
            <details>
              <summary class="small fw-semibold">Last run summary</summary>
              <div class="mt-2">
                <JobRunSummary result={lastRun} title="Last Run" empty="" />
              </div>
            </details>
          ) : (
            <div class="small text-muted">No due-work run has been executed in this session yet.</div>
          )}
        </div>

        {preview && (
          <details class="mt-3">
            <summary class="small fw-semibold">Preview details</summary>
            <div class="mt-2">
              <JobRunSummary result={preview} title="Preview (Dry Run)" empty="No preview available." />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
