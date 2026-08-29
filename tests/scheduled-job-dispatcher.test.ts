import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  claimJob,
  dispatchScheduledJobs,
  reapAbandonedRuns,
  recordJobOutcome,
  requestJobWake,
  selectRunnableJobs,
} from "../functions/_lib/services/scheduled-jobs/dispatcher";
import type { ScheduledJobDefinition } from "../functions/_lib/services/scheduled-jobs/types";

const JOB = "retention" as const;

async function jobRow() {
  const [row] = await queryAll<{
    next_run_at: string;
    last_status: string | null;
    last_run_at: string | null;
    last_success_at: string | null;
    consecutive_failures: number;
    consecutive_abandoned: number;
    running_since: string | null;
    wake_requested: number;
  }>(
    env.DB,
    `SELECT next_run_at, last_status, last_run_at, last_success_at, consecutive_failures,
            consecutive_abandoned, running_since, wake_requested
       FROM scheduled_jobs WHERE job_key = ?`,
    [JOB],
  );
  return row;
}

/** Forces the row into a state the dispatcher should act on. */
async function setJob(fields: Record<string, string | number | null>): Promise<void> {
  const assignments = Object.keys(fields)
    .map((column) => `${column} = ?`)
    .join(", ");
  await env.DB.prepare(`UPDATE scheduled_jobs SET ${assignments} WHERE job_key = ?`)
    .bind(...Object.values(fields), JOB)
    .run();
}

describe("scheduled job dispatcher", () => {
  beforeEach(async () => {
    await resetDb();
    await setJob({
      next_run_at: "2000-01-01T00:00:00.000Z",
      running_since: null,
      lease_expires_at: null,
      run_token: null,
      paused_at: null,
      last_status: null,
      consecutive_failures: 0,
      consecutive_abandoned: 0,
      wake_requested: 0,
    });
  });

  it("claims a due job exactly once, so a concurrent pass cannot double-run it", async () => {
    const first = await claimJob(env.DB, JOB, 600);
    const second = await claimJob(env.DB, JOB, 600);
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect((await jobRow()).running_since).not.toBeNull();
  });

  it("reaps a run whose lease expired, because a terminated invocation records nothing itself", async () => {
    await setJob({
      running_since: "2000-01-01T00:00:00.000Z",
      lease_expires_at: "2000-01-01T00:10:00.000Z",
      run_token: "dead-run",
    });

    expect(await reapAbandonedRuns(env.DB)).toBe(1);

    const row = await jobRow();
    expect(row.last_status).toBe("abandoned");
    expect(row.consecutive_abandoned).toBe(1);
    // Counted apart from failures: dying mid-run is a different defect.
    expect(row.consecutive_failures).toBe(0);
    expect(row.running_since).toBeNull();
    // Reaping must make the job eligible again, not strand it.
    expect((await selectRunnableJobs(env.DB, 10)).some((job) => job.job_key === JOB)).toBe(true);
  });

  it("does not reap a run whose lease is still valid", async () => {
    await setJob({
      running_since: "2000-01-01T00:00:00.000Z",
      lease_expires_at: "2999-01-01T00:00:00.000Z",
      run_token: "live-run",
    });
    expect(await reapAbandonedRuns(env.DB)).toBe(0);
    expect((await jobRow()).running_since).not.toBeNull();
  });

  it("never selects a paused job, and pausing loses no work", async () => {
    await setJob({ paused_at: "2000-01-01T00:00:00.000Z", paused_reason: "investigating" });
    expect((await selectRunnableJobs(env.DB, 10)).some((job) => job.job_key === JOB)).toBe(false);

    await setJob({ paused_at: null, paused_reason: null });
    // The work was never queued anywhere, so resuming simply finds it due again.
    expect((await selectRunnableJobs(env.DB, 10)).some((job) => job.job_key === JOB)).toBe(true);
  });

  it("backs off after a failure instead of auto-pausing", async () => {
    const token = await claimJob(env.DB, JOB, 600);
    await recordJobOutcome(env.DB, JOB, token!, "failed", { durationMs: 5, error: "boom" });

    const row = await jobRow();
    expect(row.last_status).toBe("failed");
    expect(row.consecutive_failures).toBe(1);
    expect(row.last_success_at).toBeNull();
    expect(row.next_run_at > new Date().toISOString()).toBe(true);
    expect((await selectRunnableJobs(env.DB, 10)).some((job) => job.job_key === JOB)).toBe(false);
  });

  it("separates last_run_at from last_success_at so a persistently failing job is visible", async () => {
    const first = await claimJob(env.DB, JOB, 600);
    await recordJobOutcome(env.DB, JOB, first!, "succeeded", { durationMs: 1 });
    const succeeded = await jobRow();
    expect(succeeded.last_success_at).not.toBeNull();

    await setJob({ next_run_at: "2000-01-01T00:00:00.000Z" });
    const second = await claimJob(env.DB, JOB, 600);
    await recordJobOutcome(env.DB, JOB, second!, "failed", { durationMs: 1, error: "boom" });

    const failed = await jobRow();
    expect(failed.last_status).toBe("failed");
    // Ran just now, but the last success is the earlier one — the case a single
    // timestamp would hide. A failure must not advance last_success_at.
    expect(failed.last_success_at).toBe(succeeded.last_success_at);
  });

  it("ignores an outcome written with a stale run token", async () => {
    const token = await claimJob(env.DB, JOB, 600);
    await recordJobOutcome(env.DB, JOB, "not-the-current-token", "succeeded", { durationMs: 1 });
    expect((await jobRow()).running_since).not.toBeNull();

    await recordJobOutcome(env.DB, JOB, token!, "succeeded", { durationMs: 1 });
    expect((await jobRow()).running_since).toBeNull();
  });

  it("runs a woken job before its interval and clears the wake flag", async () => {
    await setJob({ next_run_at: "2999-01-01T00:00:00.000Z" });
    expect((await selectRunnableJobs(env.DB, 10)).some((job) => job.job_key === JOB)).toBe(false);

    await requestJobWake(env.DB, JOB);
    expect((await selectRunnableJobs(env.DB, 10)).some((job) => job.job_key === JOB)).toBe(true);

    await claimJob(env.DB, JOB, 600);
    expect((await jobRow()).wake_requested).toBe(0);
  });

  it("records a failing job without aborting the pass, and honours a job's own next wake", async () => {
    const definitions: ScheduledJobDefinition[] = [
      {
        key: "retention",
        leaseSeconds: 600,
        run: async () => {
          throw new Error("job exploded");
        },
      },
      {
        key: "due_work",
        leaseSeconds: 600,
        run: async () => ({ nextRunAt: "2999-06-01T00:00:00.000Z" }),
      },
    ];
    await env.DB.prepare("UPDATE scheduled_jobs SET next_run_at = '2000-01-01T00:00:00.000Z'").run();

    const outcome = await dispatchScheduledJobs(env as never, definitions, {
      maxJobsPerPass: 10,
      d1QueryBudget: 900,
    });

    // One job throwing must not prevent the other from running.
    expect(outcome.ran).toBe(2);
    expect(outcome.failed).toBe(1);
    expect((await jobRow()).last_status).toBe("failed");

    const [dueWork] = await queryAll<{ next_run_at: string; last_status: string }>(
      env.DB,
      "SELECT next_run_at, last_status FROM scheduled_jobs WHERE job_key = 'due_work'",
    );
    expect(dueWork.last_status).toBe("succeeded");
    // A job that derives its own wake time from domain state overrides the interval.
    expect(dueWork.next_run_at).toBe("2999-06-01T00:00:00.000Z");
  });
});

describe("computed next wake", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sleeps until the next real deadline instead of polling, but never past the reconciliation floor", async () => {
    const { boundedNextRunAt } = await import("../functions/_lib/services/scheduled-jobs/next-due");
    const floorSeconds = 86_400;

    // A deadline sooner than the floor wins: the job wakes when work is due.
    const soon = new Date(Date.now() + 60_000).toISOString();
    expect(boundedNextRunAt(soon, floorSeconds)).toBe(soon);

    // A deadline beyond the floor does not extend the sleep — the periodic
    // pass remains the safety net if a deadline was never recorded.
    const distant = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const capped = boundedNextRunAt(distant, floorSeconds);
    expect(capped! < distant).toBe(true);

    // No known deadline still schedules the reconciliation pass.
    expect(boundedNextRunAt(null, floorSeconds)).toBeTruthy();

    // An overdue deadline must not schedule a wake in the past.
    const overdue = "2000-01-01T00:00:00.000Z";
    expect(boundedNextRunAt(overdue, floorSeconds)! >= new Date(Date.now() - 5_000).toISOString()).toBe(true);
  });
});
