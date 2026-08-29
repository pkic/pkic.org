import type { Permission } from "../../../../assets/shared/schemas/permissions";
import type { D1QueryBudget } from "../../db/query-budget";
import type { Env } from "../../types";

export type ScheduledJobKey =
  | "due_work"
  | "on_hold_due_work"
  | "ec_auto_approve"
  | "google_groups_sync"
  | "sponsorship_due_work"
  | "votes_due_work"
  | "retention"
  | "consultation_batch"
  | "ec_review_batch"
  | "working_group_chair_digest";

export interface ScheduledJobRunContext {
  env: Env;
  d1QueryBudget: D1QueryBudget;
}

export interface ScheduledJobOutcome {
  /**
   * Optional wake time this job derived from its own domain state — for
   * example the next vote open or close. Returning it gives timer precision
   * without a per-item timer, and because it is recomputed on every run a
   * stale or missed value corrects itself.
   */
  nextRunAt?: string;
  /** Free-form counters recorded for observability only. */
  summary?: Record<string, unknown>;
}

export interface ScheduledJobDefinition {
  key: ScheduledJobKey;
  /**
   * Grants a manual trigger must hold in addition to `scheduler:manage`.
   *
   * The scheduled path runs as the platform, but a human triggering a job
   * must not gain through the scheduler what they could not do directly —
   * running retention would otherwise redact user data without
   * `users:anonymize`.
   */
  requiredPermissions?: readonly Permission[];
  /**
   * How long a single run may hold its lease. A run that dies without
   * clearing the lease is reaped as abandoned once this elapses, so it must
   * comfortably exceed the job's normal duration.
   */
  leaseSeconds: number;
  run(context: ScheduledJobRunContext): Promise<ScheduledJobOutcome | void>;
}

export type ScheduledJobStatus = "succeeded" | "failed" | "abandoned" | "budget_exhausted";

export interface ScheduledJobRow {
  job_key: ScheduledJobKey;
  interval_seconds: number;
  next_run_at: string;
  wake_requested: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: ScheduledJobStatus | null;
  last_error: string | null;
  last_duration_ms: number | null;
  consecutive_failures: number;
  consecutive_abandoned: number;
  running_since: string | null;
  lease_expires_at: string | null;
  paused_at: string | null;
  paused_reason: string | null;
}

export const SCHEDULED_JOB_COLUMNS = `job_key, interval_seconds, next_run_at, wake_requested,
  last_run_at, last_success_at, last_status, last_error, last_duration_ms,
  consecutive_failures, consecutive_abandoned, running_since, lease_expires_at,
  paused_at, paused_reason`;
