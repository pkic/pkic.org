import { all, run } from "../../db/queries";
import { logInfo } from "../../logging";
import type { DatabaseLike, Env } from "../../types";
import { uuid } from "../../utils/ids";
import { runScheduledJobWithD1Budget } from "../scheduled-job-runner";
import {
  SCHEDULED_JOB_COLUMNS,
  type ScheduledJobDefinition,
  type ScheduledJobKey,
  type ScheduledJobRow,
  type ScheduledJobStatus,
} from "./types";

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/** Caps exponential backoff so a persistently failing job still retries daily. */
const MAX_BACKOFF_SECONDS = 86_400;

/**
 * Records runs that died without clearing their lease.
 *
 * A scheduled invocation that exceeds its CPU limit is terminated, so no
 * `catch` or `finally` is guaranteed to run and a crashed job cannot report
 * itself. An expired lease is the only reliable signal, so this must run
 * before selection — otherwise the job stays permanently "running" and is
 * never picked up again.
 */
export async function reapAbandonedRuns(db: DatabaseLike): Promise<number> {
  const result = await run(
    db,
    `UPDATE scheduled_jobs
        SET last_status = 'abandoned',
            last_run_at = COALESCE(last_run_at, running_since),
            consecutive_abandoned = consecutive_abandoned + 1,
            last_error = 'Run did not complete before its lease expired',
            running_since = NULL,
            lease_expires_at = NULL,
            run_token = NULL,
            next_run_at = ${NOW_SQL},
            updated_at = ${NOW_SQL}
      WHERE running_since IS NOT NULL
        AND lease_expires_at <= ${NOW_SQL}`,
  );
  const reaped = result.changes;
  if (reaped > 0) logInfo("SCHEDULED_JOB_RUNS_REAPED", { reaped });
  return reaped;
}

/** Jobs that are due or explicitly woken, excluding paused and in-flight ones. */
export async function selectRunnableJobs(db: DatabaseLike, limit: number): Promise<ScheduledJobRow[]> {
  return all<ScheduledJobRow>(
    db,
    `SELECT ${SCHEDULED_JOB_COLUMNS}
       FROM scheduled_jobs
      WHERE paused_at IS NULL
        AND running_since IS NULL
        AND (wake_requested = 1 OR next_run_at <= ${NOW_SQL})
      ORDER BY next_run_at ASC, job_key ASC
      LIMIT ?`,
    [limit],
  );
}

/**
 * Takes the lease for one job. The guard in the WHERE clause makes the claim
 * atomic, so two concurrent dispatcher invocations cannot both run a job:
 * only the update that observes `running_since IS NULL` changes a row.
 */
export async function claimJob(
  db: DatabaseLike,
  jobKey: ScheduledJobKey,
  leaseSeconds: number,
): Promise<string | null> {
  const token = uuid();
  const result = await run(
    db,
    `UPDATE scheduled_jobs
        SET running_since = ${NOW_SQL},
            lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || ? || ' seconds'),
            run_token = ?,
            wake_requested = 0,
            updated_at = ${NOW_SQL}
      WHERE job_key = ?
        AND paused_at IS NULL
        AND running_since IS NULL`,
    [leaseSeconds, token, jobKey],
  );
  return result.changes > 0 ? token : null;
}

export async function recordJobOutcome(
  db: DatabaseLike,
  jobKey: ScheduledJobKey,
  token: string,
  status: ScheduledJobStatus,
  options: { durationMs: number; error?: string; nextRunAt?: string },
): Promise<void> {
  // The backoff needs the row's own interval and failure count, so it is
  // computed in SQL rather than reading the row back first. A failure backs
  // off rather than auto-pausing: pausing notification work would risk nobody
  // being reminded at all.
  await run(
    db,
    `UPDATE scheduled_jobs
        SET last_status = ?1,
            last_error = ?2,
            last_duration_ms = ?3,
            last_run_at = ${NOW_SQL},
            last_success_at = CASE WHEN ?1 = 'succeeded' THEN ${NOW_SQL} ELSE last_success_at END,
            consecutive_failures = CASE WHEN ?1 = 'succeeded' THEN 0 ELSE consecutive_failures + 1 END,
            consecutive_abandoned = CASE WHEN ?1 = 'succeeded' THEN 0 ELSE consecutive_abandoned END,
            next_run_at = CASE
              WHEN ?4 IS NOT NULL THEN ?4
              WHEN ?1 = 'succeeded'
                THEN strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || interval_seconds || ' seconds')
              ELSE strftime(
                '%Y-%m-%dT%H:%M:%fZ','now',
                '+' || MIN(${MAX_BACKOFF_SECONDS}, interval_seconds * (1 << MIN(consecutive_failures + 1, 10))) || ' seconds'
              )
            END,
            running_since = NULL,
            lease_expires_at = NULL,
            run_token = NULL,
            updated_at = ${NOW_SQL}
      WHERE job_key = ?5 AND run_token = ?6`,
    [status, options.error ?? null, options.durationMs, options.nextRunAt ?? null, jobKey, token],
  );
}

/** Marks a job for the next dispatcher pass without waiting for its interval. */
export async function requestJobWake(db: DatabaseLike, jobKey: ScheduledJobKey): Promise<void> {
  await run(
    db,
    `UPDATE scheduled_jobs SET wake_requested = 1, updated_at = ${NOW_SQL} WHERE job_key = ?`,
    [jobKey],
  );
}

/**
 * Runs every job that is due. Each job keeps its own D1 query budget, so one
 * job exhausting its budget neither fails the pass nor starves the others.
 */
export async function dispatchScheduledJobs(
  env: Env,
  definitions: readonly ScheduledJobDefinition[],
  options: { maxJobsPerPass: number; d1QueryBudget: number },
): Promise<{ reaped: number; ran: number }> {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const reaped = await reapAbandonedRuns(env.DB);
  const runnable = await selectRunnableJobs(env.DB, options.maxJobsPerPass);

  let ran = 0;
  for (const row of runnable) {
    const definition = byKey.get(row.job_key);
    if (!definition) continue;
    const token = await claimJob(env.DB, row.job_key, definition.leaseSeconds);
    if (!token) continue;

    const startedAt = Date.now();
    try {
      const outcome = await runScheduledJobWithD1Budget(
        env,
        row.job_key,
        options.d1QueryBudget,
        (jobEnv, d1QueryBudget) => definition.run({ env: jobEnv, d1QueryBudget }),
      );
      const durationMs = Date.now() - startedAt;
      if (outcome.status === "d1_query_budget_exhausted") {
        await recordJobOutcome(env.DB, row.job_key, token, "budget_exhausted", {
          durationMs,
          error: "D1 query budget exhausted before the job completed",
        });
      } else {
        await recordJobOutcome(env.DB, row.job_key, token, "succeeded", {
          durationMs,
          ...(outcome.result && outcome.result.nextRunAt ? { nextRunAt: outcome.result.nextRunAt } : {}),
        });
      }
      ran += 1;
      logInfo("SCHEDULED_JOB_COMPLETED", { job: row.job_key, status: outcome.status, durationMs });
    } catch (error) {
      await recordJobOutcome(env.DB, row.job_key, token, "failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown scheduled job failure",
      });
      logInfo("SCHEDULED_JOB_FAILED", { job: row.job_key });
    }
  }
  return { reaped, ran };
}
