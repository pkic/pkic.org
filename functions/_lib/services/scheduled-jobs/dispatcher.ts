import { DEPENDENCY_ERROR_CODE } from "../../../../assets/shared/schemas/dependency-failure";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { getAvailability } from "../../availability";
import { all, run } from "../../db/queries";
import { AppError } from "../../errors";
import { logInfo } from "../../logging";
import type { DatabaseLike, Env, StatementLike } from "../../types";
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
/** A dead run already held its lease, and a repeatedly dying job can still have reminders to send. */
const MAX_ABANDONED_BACKOFF_SECONDS = 3_600;
/** Pauses before each repeat of an outcome write that D1 could not accept. */
const OUTCOME_RETRY_DELAYS_MS = [500, 2_000, 5_000] as const;

/**
 * Records runs that died without clearing their lease.
 *
 * A scheduled invocation that exceeds its CPU limit is terminated, so no
 * `catch` or `finally` is guaranteed to run and a crashed job cannot report
 * itself. An expired lease is the only reliable signal, so this must run
 * before selection — otherwise the job stays permanently "running" and is
 * never picked up again. One abandoned run restarts at once; a job that keeps
 * dying backs off so it does not repeat its load on every lease expiry.
 */
export async function reapAbandonedRuns(db: DatabaseLike): Promise<number> {
  const result = await run(
    db,
    `UPDATE scheduled_jobs
        SET last_status = 'abandoned',
            last_run_at = running_since,
            consecutive_abandoned = consecutive_abandoned + 1,
            last_error = 'Run did not complete before its lease expired',
            running_since = NULL,
            lease_expires_at = NULL,
            run_token = NULL,
            next_run_at = CASE WHEN consecutive_abandoned = 0 THEN ${NOW_SQL} ELSE strftime(
              '%Y-%m-%dT%H:%M:%fZ','now',
              '+' || MIN(${MAX_ABANDONED_BACKOFF_SECONDS}, interval_seconds * (1 << MIN(consecutive_abandoned, 10))) || ' seconds'
            ) END,
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
  const claim = prepareJobClaim(db, jobKey, leaseSeconds);
  const result = await claim.statement.run();
  return result.meta?.changes === 1 ? claim.token : null;
}

/**
 * Builds the canonical compare-and-set lease claim. Manual runs compose this
 * statement with live authorization and audit guards in one D1 batch, while
 * the platform dispatcher executes the same statement directly.
 */
export function prepareJobClaim(
  db: DatabaseLike,
  jobKey: ScheduledJobKey,
  leaseSeconds: number,
): { token: string; statement: StatementLike } {
  const token = uuid();
  return {
    token,
    statement: db
      .prepare(
        `UPDATE scheduled_jobs
        SET running_since = ${NOW_SQL},
            last_run_at = ${NOW_SQL},
            lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || ? || ' seconds'),
            run_token = ?,
            wake_requested = 0,
            updated_at = ${NOW_SQL}
      WHERE job_key = ?
        AND paused_at IS NULL
        AND running_since IS NULL`,
      )
      .bind(leaseSeconds, token, jobKey),
  };
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

/**
 * Releases the lease through a brief D1 outage, so one unrecorded outcome does
 * not hold the job for its whole lease. The run token makes a repeat harmless.
 */
async function recordJobOutcomeDurably(...outcome: Parameters<typeof recordJobOutcome>): Promise<void> {
  for (const delayMs of OUTCOME_RETRY_DELAYS_MS) {
    try {
      return await recordJobOutcome(...outcome);
    } catch (error) {
      if (!(error instanceof AppError && error.code === DEPENDENCY_ERROR_CODE)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  await recordJobOutcome(...outcome);
}

/** Marks a job for the next dispatcher pass without waiting for its interval. */
export function prepareJobWake(
  db: DatabaseLike,
  jobKey: ScheduledJobKey,
  condition?: AuthorizationEvidence,
): StatementLike {
  return db
    .prepare(
      `${condition ? `WITH wake_condition AS MATERIALIZED(${condition.sql}) ` : ""}UPDATE scheduled_jobs SET wake_requested = 1, updated_at = ${NOW_SQL} WHERE job_key = ? ${condition ? "AND EXISTS(SELECT 1 FROM wake_condition)" : ""}`,
    )
    .bind(...(condition?.bindings ?? []), jobKey);
}

export async function requestJobWake(db: DatabaseLike, jobKey: ScheduledJobKey): Promise<void> {
  await prepareJobWake(db, jobKey).run();
}

/**
 * Runs every job that is due. Each job keeps its own D1 query budget, so one
 * job exhausting its budget neither fails the pass nor starves the others.
 */
export async function dispatchScheduledJobs(
  env: Env,
  definitions: readonly ScheduledJobDefinition[],
  options: { maxJobsPerPass: number; d1QueryBudget: number },
): Promise<{ reaped: number; ran: number; failed: number }> {
  if (getAvailability(env, Date.now(), "background").mode !== "normal") return { reaped: 0, ran: 0, failed: 0 };
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const reaped = await reapAbandonedRuns(env.DB);
  const runnable = await selectRunnableJobs(env.DB, options.maxJobsPerPass);

  let ran = 0;
  let failed = 0;
  let invocationUsed = false;
  for (const row of runnable) {
    if (getAvailability(env, Date.now(), "background").mode !== "normal") break;
    const definition = byKey.get(row.job_key);
    if (!definition) continue;
    if (definition.dedicatedInvocation && invocationUsed) continue;
    const token = await claimJob(env.DB, row.job_key, definition.leaseSeconds);
    if (!token) continue;

    const startedAt = Date.now();
    logInfo("SCHEDULED_JOB_CLAIMED", { job: row.job_key });
    let idle = false;
    try {
      const outcome = await runScheduledJobWithD1Budget(
        env,
        row.job_key,
        options.d1QueryBudget,
        (jobEnv, d1QueryBudget) => definition.run({ env: jobEnv, d1QueryBudget }),
      );
      const durationMs = Date.now() - startedAt;
      const result = outcome.status === "completed" && outcome.result ? outcome.result : undefined;
      idle = result?.idle === true;
      if (outcome.status === "d1_query_budget_exhausted") {
        await recordJobOutcomeDurably(env.DB, row.job_key, token, "budget_exhausted", {
          durationMs,
          error: "D1 query budget exhausted before the job completed",
        });
      } else {
        await recordJobOutcomeDurably(env.DB, row.job_key, token, "succeeded", {
          durationMs,
          ...(result?.nextRunAt ? { nextRunAt: result.nextRunAt } : {}),
        });
      }
      ran += 1;
      logInfo("SCHEDULED_JOB_COMPLETED", {
        job: row.job_key,
        status: outcome.status,
        durationMs,
        summary: result?.summary,
      });
    } catch (error) {
      await recordJobOutcomeDurably(env.DB, row.job_key, token, "failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown scheduled job failure",
      });
      ran += 1;
      failed += 1;
      logInfo("SCHEDULED_JOB_FAILED", { job: row.job_key });
    }
    if (idle) continue;
    invocationUsed = true;
    if (definition.dedicatedInvocation) break;
  }
  return { reaped, ran, failed };
}
