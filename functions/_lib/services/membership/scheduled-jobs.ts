import { isMailingListSyncEnabled } from "../google-groups/mailing-list-policy";
import { createGoogleGroupsDeliveryProvider, isGoogleGroupsSyncConfigured } from "../google-groups/directory-client";
import { recordProviderAbsence, recordProviderPresences } from "../google-groups/observe-membership";
import {
  reconcileMailingListDeliveries,
  MAX_RECONCILED_MAILING_LISTS,
} from "../mailing-list-subscriptions/reconcile-delivery-lists";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { drainGoogleGroupsEnrollmentNotificationIntents, processGoogleGroupsSyncQueue } from "../google-groups";
import { logInfo } from "../../logging";
import type { DatabaseLike, Env } from "../../types";

const MAX_GOOGLE_GROUPS_SYNC_PER_PASS = 25;
const GOOGLE_GROUPS_SYNC_RESERVE_HEADROOM_STATEMENTS = 20 + 3 * MAX_RECONCILED_MAILING_LISTS;

/**
 * The queue processor plus durable notification drain has a conservative
 * upper bound of 3 + 16N D1 statements for N claimed rows: due-list,
 * re-list-and-claim batch, actionable-claim load, recipient/calendar reads,
 * five-statement completion batches, and a bounded three-statement-per-user
 * enrollment drain, plus a check of previously confirmed subscriptions.
 * Headroom covers bounded full-roster reads and presence batches.
 * The missing-user/failure paths use fewer statements, and
 * the durable desired-state queue admits at most one completed add per row.
 */
function googleGroupsSyncReserveStatements(limit: number): number {
  return 3 + 16 * limit + GOOGLE_GROUPS_SYNC_RESERVE_HEADROOM_STATEMENTS;
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
  const result = await processGoogleGroupsSyncQueue(db, env, Math.max(1, Math.floor(boundedLimit / 2)));
  await drainGoogleGroupsEnrollmentNotificationIntents(db, boundedLimit);
  let reconciled = 0;
  if (isGoogleGroupsSyncConfigured(env) && result.processed < boundedLimit) {
    const provider = await createGoogleGroupsDeliveryProvider(env);
    reconciled = (
      await reconcileMailingListDeliveries(db, provider, {
        limit: boundedLimit - result.processed,
        dryRun: false,
        canApply: (listEmail) => isMailingListSyncEnabled(db, listEmail),
        recordUnsubscribe: (userId, listEmail) => recordProviderAbsence(db, userId, listEmail),
        recordPresence: (addresses, listEmail) => recordProviderPresences(db, listEmail, addresses),
      })
    ).changed;
  }

  if (result.skippedUnconfigured) {
    logInfo("membership_scheduled_jobs_google_groups_unconfigured", {});
  }

  return {
    processed: result.processed + reconciled,
    succeeded: result.succeeded + reconciled,
    failed: result.failed,
    skippedUnconfigured: result.skippedUnconfigured,
    deferredForBudget: false,
  };
}
