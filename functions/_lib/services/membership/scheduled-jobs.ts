import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { drainGoogleGroupsEnrollmentNotificationIntents, processGoogleGroupsSyncQueue } from "../google-groups";
import { logInfo } from "../../logging";
import type { DatabaseLike, Env } from "../../types";

const MAX_GOOGLE_GROUPS_SYNC_PER_PASS = 25;
const GOOGLE_GROUPS_SYNC_RESERVE_HEADROOM_STATEMENTS = 20;

/**
 * The queue processor plus durable notification drain has a conservative
 * upper bound of 3 + 14N D1 statements for N claimed rows: due-list,
 * re-list-and-claim batch, actionable-claim load, recipient/calendar reads,
 * five-statement completion batches, and a bounded three-statement-per-user
 * enrollment drain. The missing-user/failure paths use fewer statements, and
 * the durable desired-state queue admits at most one completed add per row.
 */
function googleGroupsSyncReserveStatements(limit: number): number {
  return 3 + 14 * limit + GOOGLE_GROUPS_SYNC_RESERVE_HEADROOM_STATEMENTS;
}

export async function runGoogleGroupsSyncPass(
  db: DatabaseLike,
  env: Env,
  limit = MAX_GOOGLE_GROUPS_SYNC_PER_PASS,
  d1QueryBudget?: D1QueryBudget,
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skippedUnconfigured: boolean;
  deferredForBudget: boolean;
}> {
  const boundedLimit = Math.max(0, Math.min(MAX_GOOGLE_GROUPS_SYNC_PER_PASS, Math.floor(limit)));
  const reserveStatements = googleGroupsSyncReserveStatements(boundedLimit);
  if (boundedLimit === 0 || !hasD1QueryCapacity(d1QueryBudget, reserveStatements)) {
    return { processed: 0, succeeded: 0, failed: 0, skippedUnconfigured: false, deferredForBudget: boundedLimit > 0 };
  }
  const result = await processGoogleGroupsSyncQueue(db, env, boundedLimit);
  await drainGoogleGroupsEnrollmentNotificationIntents(db, boundedLimit);

  if (result.skippedUnconfigured) {
    logInfo("membership_scheduled_jobs_google_groups_unconfigured", {});
  }

  return {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    skippedUnconfigured: result.skippedUnconfigured,
    deferredForBudget: false,
  };
}
