/**
 * Scheduled jobs — the dispatcher registry, its cadence, and its outcomes.
 *
 * Rendered by the design system's DataTable rather than a hand-built table:
 * the caption names the table for anyone listing the tables on the page, and
 * the pause form arrives as the row's own detail row instead of being nested
 * inside the actions cell, where it inherited that cell's end alignment.
 */
import { useEffect, useState } from "preact/hooks";
import {
  schedulerJobRunResponseSchema,
  schedulerJobsListResponseSchema,
  schedulerJobStateResponseSchema,
  type ScheduledJobResource,
} from "../../../../../shared/schemas/scheduler";
import { Badge, statusLabel } from "../../../../components/Badge";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Textarea } from "../../../../ui/TextControl";
import { getJson, patchJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";
import "../../../../ui/Content.css";

/** The shortest reason the state endpoint accepts. Mirrors the shared schema. */
const MINIMUM_PAUSE_REASON = 3;

function titleFromKey(jobKey: string): string {
  return jobKey.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatInterval(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"}`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour${seconds === 3_600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
}

function JobIdentity({ job }: { job: ScheduledJobResource }) {
  return (
    <div class="pk-stack pk-stack--tight">
      <div>{titleFromKey(job.jobKey)}</div>
      <div class="pk-mono pk-small">{job.jobKey}</div>
      {job.pausedAt !== null && job.pausedReason ? <div class="pk-small">{job.pausedReason}</div> : null}
    </div>
  );
}

function JobSchedule({ job }: { job: ScheduledJobResource }) {
  return (
    <div class="pk-stack pk-stack--tight">
      <div>{formatInterval(job.intervalSeconds)}</div>
      <div class="pk-small">Next {fmt(job.nextRunAt)}</div>
      {job.wakeRequested ? (
        <div class="pk-cluster">
          <Badge status="pending" label="Wake requested" />
        </div>
      ) : null}
    </div>
  );
}

function JobOutcome({ job }: { job: ScheduledJobResource }) {
  return (
    <div class="pk-stack pk-stack--tight">
      <div>{job.lastStatus ? <Badge status={job.lastStatus} /> : <span class="pk-small">Never run</span>}</div>
      <div class="pk-small">Last run {fmt(job.lastRunAt)}</div>
      <div class="pk-small">Last success {fmt(job.lastSuccessAt)}</div>
      {job.lastDurationMs !== null ? (
        <div class="pk-small">Duration {job.lastDurationMs.toLocaleString()} ms</div>
      ) : null}
    </div>
  );
}

function JobHealth({ job }: { job: ScheduledJobResource }) {
  const isPaused = job.pausedAt !== null;
  const isRunning = job.runningSince !== null;
  return (
    <div class="pk-stack pk-stack--tight">
      <div class="pk-cluster">
        {isPaused ? <Badge status="paused" label="Paused" /> : null}
        {isRunning ? <Badge status="running" label={job.leaseExpired ? "Lease expired" : "Running"} /> : null}
        {!isPaused && !isRunning ? <Badge status="active" /> : null}
      </div>
      <div class="pk-small">
        Failures {job.consecutiveFailures}; abandoned {job.consecutiveAbandoned}
      </div>
      {job.lastError ? (
        <details>
          {/* The word carries the meaning. A red line and nothing else leaves
              anyone who cannot separate the hues with an unexplained colour. */}
          <summary class="pk-small">Last error</summary>
          <div class="pk-small pk-break">{job.lastError}</div>
        </details>
      ) : null}
    </div>
  );
}

interface JobControls {
  busyJob: string | null;
  onRun: (job: ScheduledJobResource) => void;
  onResume: (job: ScheduledJobResource) => void;
  onStartPause: (job: ScheduledJobResource) => void;
}

function JobActions({ job, controls }: { job: ScheduledJobResource; controls: JobControls }) {
  const isBusy = controls.busyJob === job.jobKey;
  const isPaused = job.pausedAt !== null;
  const isRunning = job.runningSince !== null;

  return (
    <div class="pk-cluster pk-cluster--end">
      {job.capabilities.run ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={isBusy || isPaused || isRunning}
          onClick={() => controls.onRun(job)}
        >
          Run now
        </Button>
      ) : null}
      {job.capabilities.manageState ? (
        isPaused ? (
          <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => controls.onResume(job)}>
            Resume
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => controls.onStartPause(job)}>
            Pause
          </Button>
        )
      ) : null}
    </div>
  );
}

function PauseForm({
  job,
  busy,
  reason,
  onReason,
  onCancel,
  onConfirm,
}: {
  job: ScheduledJobResource;
  busy: boolean;
  reason: string;
  onReason: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const trimmed = reason.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MINIMUM_PAUSE_REASON;

  return (
    <form
      class="pk-stack pk-stack--snug"
      aria-label={`Pause ${titleFromKey(job.jobKey)}`}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      <Field
        label="Pause reason"
        required
        help="Recorded with the pause and shown beside the job until it resumes."
        state={tooShort ? "invalid" : undefined}
        message={tooShort ? `Give at least ${MINIMUM_PAUSE_REASON} characters.` : undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            minLength={MINIMUM_PAUSE_REASON}
            maxLength={500}
            value={reason}
            disabled={busy}
            onInput={(event) => onReason((event.target as HTMLTextAreaElement).value)}
          />
        )}
      </Field>
      <div class="pk-cluster pk-cluster--end">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy || trimmed.length < MINIMUM_PAUSE_REASON}>
          Confirm pause
        </Button>
      </div>
    </form>
  );
}

export function ScheduledJobs() {
  const [jobs, setJobs] = useState<ScheduledJobResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [pauseJob, setPauseJob] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState("");

  async function load(signal?: AbortSignal): Promise<void> {
    const response = await getJson("/api/v1/scheduler/jobs", schedulerJobsListResponseSchema, { signal });
    setJobs(response.jobs);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void load(controller.signal)
      .catch((loadError) => {
        if (!controller.signal.aborted) setError((loadError as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function replaceJob(updated: ScheduledJobResource): void {
    setJobs((current) => current.map((job) => (job.jobKey === updated.jobKey ? updated : job)));
  }

  async function updateState(job: ScheduledJobResource, state: "active" | "paused"): Promise<void> {
    setBusyJob(job.jobKey);
    try {
      const response = await patchJson(
        `/api/v1/scheduler/jobs/${encodeURIComponent(job.jobKey)}`,
        state === "paused" ? { state, reason: pauseReason } : { state },
        schedulerJobStateResponseSchema,
      );
      replaceJob(response.job);
      setPauseJob(null);
      setPauseReason("");
      toast(state === "paused" ? "Scheduled job paused." : "Scheduled job resumed.", "success");
    } catch (updateError) {
      toast((updateError as Error).message, "error");
    } finally {
      setBusyJob(null);
    }
  }

  async function runNow(job: ScheduledJobResource): Promise<void> {
    setBusyJob(job.jobKey);
    try {
      const result = await postJson(
        `/api/v1/scheduler/jobs/${encodeURIComponent(job.jobKey)}/runs`,
        {},
        schedulerJobRunResponseSchema,
      );
      await load();
      toast(
        `${titleFromKey(job.jobKey)} finished with status ${statusLabel(result.status).toLowerCase()}.`,
        result.status === "succeeded" ? "success" : "error",
      );
    } catch (runError) {
      toast((runError as Error).message, "error");
    } finally {
      setBusyJob(null);
    }
  }

  const controls: JobControls = {
    busyJob,
    onRun: (job) => void runNow(job),
    onResume: (job) => void updateState(job, "active"),
    onStartPause: (job) => {
      setPauseJob(job.jobKey);
      setPauseReason("");
    },
  };

  const columns: ReadonlyArray<DataTableColumn<ScheduledJobResource>> = [
    { id: "job", header: "Job", cell: (job) => <JobIdentity job={job} /> },
    { id: "schedule", header: "Schedule", cell: (job) => <JobSchedule job={job} /> },
    { id: "outcome", header: "Last outcome", cell: (job) => <JobOutcome job={job} /> },
    { id: "health", header: "Health", cell: (job) => <JobHealth job={job} /> },
    { id: "actions", header: "Actions", align: "end", cell: (job) => <JobActions job={job} controls={controls} /> },
  ];

  return (
    <div class="pk pk-stack pk-stack--snug">
      <div class="pk-stack pk-stack--tight">
        <strong>Scheduled Jobs</strong>
        <p class="pk-small">
          Inspect dispatcher cadence and outcomes. Pausing prevents future claims but does not cancel a running job.
        </p>
      </div>
      {error ? (
        <Alert tone="danger" title="Could not load the scheduled jobs.">
          {error}
        </Alert>
      ) : (
        <DataTable
          caption="Scheduled jobs"
          columns={columns}
          rows={jobs}
          rowKey={(job) => job.jobKey}
          loading={loading}
          empty={
            <EmptyState
              title="No scheduled jobs are configured."
              body="A job appears here once the dispatcher registers it."
            />
          }
          detailRow={(job) =>
            pauseJob === job.jobKey ? (
              <PauseForm
                job={job}
                busy={busyJob === job.jobKey}
                reason={pauseReason}
                onReason={setPauseReason}
                onCancel={() => setPauseJob(null)}
                onConfirm={() => void updateState(job, "paused")}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
