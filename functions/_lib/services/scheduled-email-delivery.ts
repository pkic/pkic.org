import { getConfig } from "../config";
import type { D1QueryBudget } from "../db/query-budget";
import { processPendingOutboxBatch } from "../email/outbox";
import type { Env } from "../types";
import { nowIso } from "../utils/time";

// Elapsed time includes CPU work and I/O. Stop well before the minute cron's
// 30-second CPU allowance and reserve the slowest observed batch before starting another.
const MAX_ELAPSED_MS = 20_000;
const MAX_BATCHES = 100;
const MAX_BATCH_SIZE = 10;
// Claims, guards, capability materialization, templates and failure settlement
// need headroom before starting parallel sends. Keep selection headroom as well.
const QUERIES_PER_MESSAGE_RESERVE = 20;
const SELECTION_QUERY_RESERVE = 10;

/** The existing outbox owns claims and retry policy; this job only drains ready work. */
export async function runScheduledEmailDelivery(env: Env, budget: D1QueryBudget) {
  const limit = Math.max(0, Math.min(MAX_BATCH_SIZE, getConfig(env).scheduledOutboxLimit));
  const summary = { processed: 0, failed: 0, batches: 0, stoppedReason: "empty" };
  if (!limit) return { summary: { ...summary, stoppedReason: "disabled" } };
  const deadline = Date.now() + MAX_ELAPSED_MS;
  let slowestBatchMs = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    if (Date.now() + Math.max(1_000, slowestBatchMs * 2) >= deadline) {
      return { summary: { ...summary, stoppedReason: "time_limit" }, nextRunAt: nowIso() };
    }
    const count = Math.min(
      limit,
      Math.floor((budget.remainingQueries() - SELECTION_QUERY_RESERVE) / QUERIES_PER_MESSAGE_RESERVE),
    );
    if (count <= 0) return { summary: { ...summary, stoppedReason: "d1_query_limit" }, nextRunAt: nowIso() };
    const startedAt = Date.now();
    const result = await processPendingOutboxBatch(env.DB, env, count);
    slowestBatchMs = Math.max(slowestBatchMs, Date.now() - startedAt);
    summary.processed += result.processed;
    summary.failed += result.failed;
    summary.batches++;
    if (result.selected < count) return { summary };
  }
  return { summary: { ...summary, stoppedReason: "batch_limit" }, nextRunAt: nowIso() };
}
