import type { ScheduledJob } from "../../../../assets/shared/schemas/scheduler";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { prepareAuditLog } from "../audit";
import { runScheduledJobWithD1Budget } from "../scheduled-job-runner";
import { claimJob, recordJobOutcome } from "./dispatcher";
import { SCHEDULED_JOB_COLUMNS, type ScheduledJobDefinition, type ScheduledJobRow } from "./types";

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function toScheduledJob(row: ScheduledJobRow): ScheduledJob {
  return {
    jobKey: row.job_key,
    intervalSeconds: row.interval_seconds,
    nextRunAt: row.next_run_at,
    wakeRequested: row.wake_requested === 1,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastDurationMs: row.last_duration_ms,
    consecutiveFailures: row.consecutive_failures,
    consecutiveAbandoned: row.consecutive_abandoned,
    runningSince: row.running_since,
    leaseExpiresAt: row.lease_expires_at,
    pausedAt: row.paused_at,
    pausedReason: row.paused_reason,
    // Surfaced rather than inferred by the client: a claimed run past its
    // lease is stuck and will be reaped, which reads very differently from a
    // run that is merely still going.
    leaseExpired:
      row.running_since !== null && row.lease_expires_at !== null && row.lease_expires_at <= new Date().toISOString(),
  };
}

export async function listScheduledJobs(db: DatabaseLike): Promise<ScheduledJob[]> {
  const rows = await all<ScheduledJobRow>(
    db,
    `SELECT ${SCHEDULED_JOB_COLUMNS} FROM scheduled_jobs ORDER BY job_key ASC`,
  );
  return rows.map(toScheduledJob);
}

async function requireJobRow(db: DatabaseLike, jobKey: string): Promise<ScheduledJobRow> {
  const row = await first<ScheduledJobRow>(
    db,
    `SELECT ${SCHEDULED_JOB_COLUMNS} FROM scheduled_jobs WHERE job_key = ?`,
    [jobKey],
  );
  if (!row) throw new AppError(404, "SCHEDULED_JOB_NOT_FOUND", `Unknown scheduled job '${jobKey}'`);
  return row;
}

export async function pauseScheduledJob(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  jobKey: string,
  reason: string,
): Promise<ScheduledJob> {
  await requireJobRow(db, jobKey);
  await db.batch([
    db
      .prepare(
        `UPDATE scheduled_jobs
            SET paused_at = ${NOW_SQL}, paused_by_user_id = ?, paused_reason = ?, updated_at = ${NOW_SQL}
          WHERE job_key = ?`,
      )
      .bind(actor.id, reason, jobKey),
    prepareAuditLog(db, "admin", actor.id, "scheduled_job_paused", "scheduled_job", jobKey, { reason }),
  ]);
  return toScheduledJob(await requireJobRow(db, jobKey));
}

export async function resumeScheduledJob(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  jobKey: string,
): Promise<ScheduledJob> {
  await requireJobRow(db, jobKey);
  await db.batch([
    db
      .prepare(
        `UPDATE scheduled_jobs
            SET paused_at = NULL, paused_by_user_id = NULL, paused_reason = NULL,
                next_run_at = ${NOW_SQL}, updated_at = ${NOW_SQL}
          WHERE job_key = ?`,
      )
      .bind(jobKey),
    prepareAuditLog(db, "admin", actor.id, "scheduled_job_resumed", "scheduled_job", jobKey, {}),
  ]);
  return toScheduledJob(await requireJobRow(db, jobKey));
}

/**
 * Runs one job immediately. It takes the same lease as a scheduled pass, so a
 * manual trigger cannot run concurrently with the dispatcher, and uses the
 * same D1 query budget so it cannot exceed the bounds the schedule respects.
 */
export async function runScheduledJobNow(
  db: DatabaseLike,
  env: Env,
  actor: UserBackedAuthAdmin,
  definition: ScheduledJobDefinition,
  d1QueryBudget: number,
): Promise<{ status: "succeeded" | "failed" | "budget_exhausted"; durationMs: number }> {
  const row = await requireJobRow(db, definition.key);
  if (row.paused_at !== null) {
    throw new AppError(409, "SCHEDULED_JOB_PAUSED", `Job '${definition.key}' is paused and cannot be run`);
  }
  const token = await claimJob(db, definition.key, definition.leaseSeconds);
  if (!token) {
    throw new AppError(409, "SCHEDULED_JOB_RUNNING", `Job '${definition.key}' is already running`);
  }

  await db.batch([
    prepareAuditLog(db, "admin", actor.id, "scheduled_job_triggered", "scheduled_job", definition.key, {}),
  ]);

  const startedAt = Date.now();
  try {
    const outcome = await runScheduledJobWithD1Budget(
      { ...env, DB: db },
      definition.key,
      d1QueryBudget,
      (jobEnv, budget) => definition.run({ env: jobEnv, d1QueryBudget: budget }),
    );
    const durationMs = Date.now() - startedAt;
    const status = outcome.status === "d1_query_budget_exhausted" ? "budget_exhausted" : "succeeded";
    await recordJobOutcome(db, definition.key, token, status, {
      durationMs,
      ...(status === "budget_exhausted" ? { error: "D1 query budget exhausted before the job completed" } : {}),
      ...(outcome.status === "completed" && outcome.result && outcome.result.nextRunAt
        ? { nextRunAt: outcome.result.nextRunAt }
        : {}),
    });
    return { status, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    await recordJobOutcome(db, definition.key, token, "failed", {
      durationMs,
      error: error instanceof Error ? error.message.slice(0, 500) : "Unknown scheduled job failure",
    });
    return { status: "failed", durationMs };
  }
}
