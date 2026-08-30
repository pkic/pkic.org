import { useEffect, useState } from "preact/hooks";
import {
  schedulerJobRunResponseSchema,
  schedulerJobsListResponseSchema,
  schedulerJobStateResponseSchema,
  type ScheduledJobResource,
} from "../../../../../shared/schemas/scheduler";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { getJson, patchJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";

function titleFromKey(jobKey: string): string {
  return jobKey.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatInterval(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"}`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour${seconds === 3_600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
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
        `${titleFromKey(job.jobKey)} finished with status ${result.status.replace(/_/g, " ")}.`,
        result.status === "succeeded" ? "success" : "error",
      );
    } catch (runError) {
      toast((runError as Error).message, "error");
    } finally {
      setBusyJob(null);
    }
  }

  if (loading) return <Spinner />;
  if (error) {
    return (
      <div class="alert alert-danger" role="alert">
        {error}
      </div>
    );
  }
  if (jobs.length === 0) return <p class="text-muted">No scheduled jobs are configured.</p>;

  return (
    <div>
      <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <strong>Scheduled Jobs</strong>
          <p class="mb-0 text-muted small">
            Inspect dispatcher cadence and outcomes. Pausing prevents future claims but does not cancel a running job.
          </p>
        </div>
      </div>
      <div class="table-responsive">
        <table class="table align-middle">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Schedule</th>
              <th scope="col">Last outcome</th>
              <th scope="col">Health</th>
              <th scope="col" class="text-end">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const isBusy = busyJob === job.jobKey;
              const isRunning = job.runningSince !== null;
              const isPaused = job.pausedAt !== null;
              return (
                <tr key={job.jobKey}>
                  <th scope="row">
                    <div>{titleFromKey(job.jobKey)}</div>
                    <div class="mono small text-muted">{job.jobKey}</div>
                    {isPaused && job.pausedReason ? <div class="small text-muted mt-1">{job.pausedReason}</div> : null}
                  </th>
                  <td>
                    <div>{formatInterval(job.intervalSeconds)}</div>
                    <div class="small text-muted">Next {fmt(job.nextRunAt)}</div>
                    {job.wakeRequested ? <Badge status="pending" label="Wake requested" /> : null}
                  </td>
                  <td>
                    {job.lastStatus ? <Badge status={job.lastStatus} /> : <span class="text-muted">Never run</span>}
                    <div class="small text-muted mt-1">Last run {fmt(job.lastRunAt)}</div>
                    <div class="small text-muted">Last success {fmt(job.lastSuccessAt)}</div>
                    {job.lastDurationMs !== null ? (
                      <div class="small text-muted">Duration {job.lastDurationMs.toLocaleString()} ms</div>
                    ) : null}
                  </td>
                  <td>
                    <div class="d-flex flex-wrap gap-1">
                      {isPaused ? <Badge status="paused" label="Paused" /> : null}
                      {isRunning ? (
                        <Badge status="running" label={job.leaseExpired ? "Lease expired" : "Running"} />
                      ) : null}
                      {!isPaused && !isRunning ? <Badge status="active" /> : null}
                    </div>
                    <div class="small text-muted mt-1">
                      Failures {job.consecutiveFailures}; abandoned {job.consecutiveAbandoned}
                    </div>
                    {job.lastError ? (
                      <details class="mt-1">
                        <summary class="small text-danger">Last error</summary>
                        <div class="small text-danger mt-1">{job.lastError}</div>
                      </details>
                    ) : null}
                  </td>
                  <td class="text-end">
                    <div class="d-flex flex-wrap justify-content-end gap-2">
                      {job.capabilities.run ? (
                        <button
                          type="button"
                          class="btn btn-sm btn-outline-primary"
                          disabled={isBusy || isPaused || isRunning}
                          onClick={() => void runNow(job)}
                        >
                          Run now
                        </button>
                      ) : null}
                      {job.capabilities.manageState ? (
                        isPaused ? (
                          <button
                            type="button"
                            class="btn btn-sm btn-outline-primary"
                            disabled={isBusy}
                            onClick={() => void updateState(job, "active")}
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            class="btn btn-sm btn-outline-warning"
                            disabled={isBusy}
                            onClick={() => {
                              setPauseJob(job.jobKey);
                              setPauseReason("");
                            }}
                          >
                            Pause
                          </button>
                        )
                      ) : null}
                    </div>
                    {pauseJob === job.jobKey ? (
                      <form
                        class="mt-2 text-start"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void updateState(job, "paused");
                        }}
                      >
                        <label class="form-label small" for={`pause-reason-${job.jobKey}`}>
                          Pause reason
                        </label>
                        <textarea
                          id={`pause-reason-${job.jobKey}`}
                          class="form-control form-control-sm"
                          required
                          minLength={3}
                          maxLength={500}
                          value={pauseReason}
                          onInput={(event) => setPauseReason((event.target as HTMLTextAreaElement).value)}
                        />
                        <div class="d-flex justify-content-end gap-2 mt-2">
                          <button
                            type="button"
                            class="btn btn-sm btn-outline-secondary"
                            disabled={isBusy}
                            onClick={() => setPauseJob(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            class="btn btn-sm btn-warning"
                            disabled={isBusy || pauseReason.trim().length < 3}
                          >
                            Confirm pause
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
