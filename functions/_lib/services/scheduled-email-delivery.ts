import { getConfig } from "../config";
import type { D1QueryBudget } from "../db/query-budget";
import { drainPendingOutbox } from "../email/outbox";
import type { Env } from "../types";
import { nowIso } from "../utils/time";

// Elapsed time conservatively bounds CPU work. Leave time for admitted sends
// to settle, using the slowest observed message as additional admission headroom.
const MAX_ELAPSED_MS = 20_000;
const QUERIES_PER_MESSAGE_RESERVE = 20;
const SELECTION_QUERY_RESERVE = 10;

/** The outbox owns delivery; this job reserves resources before admitting work. */
export async function runScheduledEmailDelivery(env: Env, budget: D1QueryBudget) {
  const selectionLimit = Math.max(0, Math.min(100, getConfig(env).scheduledOutboxLimit));
  if (!selectionLimit) return { summary: { processed: 0, failed: 0, selections: 0, stoppedReason: "disabled" } };
  const deadline = Date.now() + MAX_ELAPSED_MS;
  let active = 0;
  let slowestMessageMs = 0;
  let stoppedReason: string | undefined;
  const mayStart = () => {
    if (stoppedReason) return false;
    if (Date.now() + Math.max(1_000, slowestMessageMs * 2) >= deadline) stoppedReason = "time_limit";
    else if (budget.remainingQueries() < (active + 1) * QUERIES_PER_MESSAGE_RESERVE + SELECTION_QUERY_RESERVE)
      stoppedReason = "d1_query_limit";
    return !stoppedReason;
  };
  const result = await drainPendingOutbox(env.DB, env, {
    selectionLimit,
    maySelect: mayStart,
    startMessage: () => {
      if (!mayStart()) return false;
      active++;
      return true;
    },
    finishMessage: (durationMs) => {
      active--;
      slowestMessageMs = Math.max(slowestMessageMs, durationMs);
    },
  });
  const { exhausted, ...counts } = result;
  return {
    summary: { ...counts, stoppedReason: stoppedReason ?? (exhausted ? "empty" : "selection_limit") },
    ...(!exhausted ? { nextRunAt: nowIso() } : {}),
  };
}
