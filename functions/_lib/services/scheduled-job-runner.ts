import { createD1QueryBudgetedDatabase, D1QueryBudgetExceededError, type D1QueryBudget } from "../db/query-budget";
import { logInfo } from "../logging";
import type { Env } from "../types";

export type ScheduledJobRunResult<TResult> =
  | { status: "completed"; result: TResult; d1QueriesUsed: number }
  | { status: "d1_query_budget_exhausted"; d1QueriesUsed: number };

/** Runs one cron domain in its own invocation-local D1 query budget. */
export async function runScheduledJobWithD1Budget<TResult>(
  env: Env,
  name: string,
  maxD1Queries: number,
  run: (budgetedEnv: Env, budget: D1QueryBudget) => Promise<TResult>,
): Promise<ScheduledJobRunResult<TResult>> {
  const budgeted = createD1QueryBudgetedDatabase(env.DB, maxD1Queries);
  const budgetedEnv: Env = { ...env, DB: budgeted.db };
  try {
    const result = await run(budgetedEnv, budgeted.budget);
    return { status: "completed", result, d1QueriesUsed: budgeted.budget.usedQueries() };
  } catch (error) {
    if (!(error instanceof D1QueryBudgetExceededError)) throw error;
    logInfo("SCHEDULED_JOB_D1_QUERY_BUDGET_EXHAUSTED", {
      job: name,
      d1QueriesUsed: budgeted.budget.usedQueries(),
      maxD1Queries: budgeted.budget.maxQueries,
      requestedQueries: error.requestedQueries,
    });
    return { status: "d1_query_budget_exhausted", d1QueriesUsed: budgeted.budget.usedQueries() };
  }
}
