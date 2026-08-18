/**
 * Shared job registry for the 15-minute REMINDER_CRON scheduled entrypoint
 * (functions/router.ts). Before this, runScheduledJob called
 * runScheduledDueWork, runMembershipDueWork, runSponsorshipDueWork, and
 * runVotesDueWork sequentially with no shared deadline and no per-job
 * isolation — a throw from any one of them aborted every job after it on
 * that invocation, and only runScheduledDueWork participated in any
 * time/subrequest budget at all (PR #1 review §9.1).
 *
 * This registry owns one invocation-wide deadline, runs each job
 * sequentially (never concurrently — these are all D1-heavy workloads),
 * and isolates every job with its own try/catch so one job's failure can
 * never suppress its siblings. A job is skipped outright (not started) once
 * less than its own declared minimum remaining time is left in the shared
 * budget, rather than being started and left to blow past it.
 */
import { logError, logInfo } from "../logging";
import type { Env } from "../types";

export interface ScheduledJobBudget {
  /** Wall-clock deadline (ms since epoch) for the whole registry run. */
  readonly deadlineAt: number;
  /** Milliseconds remaining before deadlineAt, floored at 0. */
  remainingMs(): number;
}

export interface ScheduledJobDefinition<TResult> {
  name: string;
  /** Minimum time this job needs to be worth starting; skipped outright if less remains. */
  minRemainingMsToRun: number;
  run(env: Env, budget: ScheduledJobBudget): Promise<TResult>;
}

export type ScheduledJobOutcome =
  | { name: string; status: "completed"; durationMs: number; result: unknown }
  | { name: string; status: "error"; durationMs: number; error: string }
  | { name: string; status: "skipped_budget"; remainingMs: number };

export interface ScheduledJobRegistryResult {
  outcomes: ScheduledJobOutcome[];
  elapsedMs: number;
}

function makeBudget(deadlineAt: number): ScheduledJobBudget {
  return { deadlineAt, remainingMs: () => Math.max(0, deadlineAt - Date.now()) };
}

/**
 * Runs `jobs` sequentially against one shared deadline (`totalBudgetMs` from
 * now). Never runs jobs concurrently. A throw from one job is caught and
 * recorded as that job's outcome, not propagated — later jobs still get a
 * chance to run on the same invocation.
 */
export async function runScheduledJobRegistry(
  env: Env,
  jobs: ScheduledJobDefinition<unknown>[],
  totalBudgetMs: number,
): Promise<ScheduledJobRegistryResult> {
  const startedAt = Date.now();
  const budget = makeBudget(startedAt + totalBudgetMs);
  const outcomes: ScheduledJobOutcome[] = [];

  for (const job of jobs) {
    const remainingMs = budget.remainingMs();
    if (remainingMs < job.minRemainingMsToRun) {
      outcomes.push({ name: job.name, status: "skipped_budget", remainingMs });
      logInfo("SCHEDULED_JOB_REGISTRY_ITEM_SKIPPED_BUDGET", { job: job.name, remainingMs });
      continue;
    }

    const jobStartedAt = Date.now();
    try {
      const result = await job.run(env, budget);
      outcomes.push({ name: job.name, status: "completed", durationMs: Date.now() - jobStartedAt, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ name: job.name, status: "error", durationMs: Date.now() - jobStartedAt, error: message });
      // Distinct key from the top-level "SCHEDULED_JOB_FAILED" (router.ts) —
      // this is one job in the registry failing, not the whole invocation;
      // later jobs in `jobs` still run (PR #1 review §9.1).
      logError("SCHEDULED_JOB_REGISTRY_ITEM_FAILED", { job: job.name, error: message });
    }
  }

  return { outcomes, elapsedMs: Date.now() - startedAt };
}
