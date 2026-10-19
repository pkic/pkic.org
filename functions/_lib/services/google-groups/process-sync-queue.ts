import { isMailingListSyncEnabled } from "./mailing-list-policy";
import { isGoogleGroupsSuppressed } from "./observe-membership";
import { supersedeSuppressedGoogleGroupsAdd } from "./sync-queue";
import { logError, logInfo } from "../../logging";
import type { DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import type {
  GoogleServiceAccountEnv,
  ProcessGoogleGroupsSyncResult,
  GoogleGroupsMembershipOperation,
} from "./contracts";
import {
  createGoogleGroupsDirectoryClient,
  createGoogleGroupsDryRunDirectoryClient,
  isGoogleGroupsSyncConfigured,
} from "./directory-client";
import { prepareGoogleGroupsSyncNotificationStatements } from "./notification-intents";
import {
  claimPendingGoogleGroupsSyncRows,
  completeGoogleGroupsDirectoryEffect,
  failGoogleGroupsSyncClaimForMissingUser,
  listPendingGoogleGroupsSync,
  loadActionableGoogleGroupsSyncRows,
  recordGoogleGroupsDirectoryFailure,
  supersedeStaleGoogleGroupsSyncClaims,
} from "./sync-queue";

function emptyResult(skippedUnconfigured: boolean): ProcessGoogleGroupsSyncResult {
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skippedUnconfigured,
    completedAddsByUser: {},
  };
}

/**
 * Applies a bounded batch of durable Google Groups membership intents.
 * D1 owns desired state, claims, retries, and lease-fenced finalization;
 * the Directory adapter owns only authentication and the external effect.
 */
export async function processGoogleGroupsSyncQueue(
  db: DatabaseLike,
  env: GoogleServiceAccountEnv,
  limit = 25,
  options: { dryRun?: boolean } = {},
): Promise<ProcessGoogleGroupsSyncResult> {
  // Every invocation owns one stable batch identity. Enrollment intents from
  // this pass can therefore be grouped into exactly one email per user while
  // overlapping passes remain separate, preserving the prior per-pass UX.
  const syncPassId = uuid();
  const dryRun = options.dryRun === true;
  const plannedOperations: GoogleGroupsMembershipOperation[] = [];
  if (!isGoogleGroupsSyncConfigured(env)) {
    logInfo("google_groups_sync_skipped_unconfigured", {
      reason:
        "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / GOOGLE_WORKSPACE_ADMIN_EMAIL not configured",
    });
    return emptyResult(true);
  }

  // Avoid signing a JWT and making an OAuth request when no durable work is due.
  const candidates = await listPendingGoogleGroupsSync(db, limit);
  if (candidates.length === 0) return { ...emptyResult(false), ...(dryRun ? { plannedOperations } : {}) };

  let directoryClient;
  try {
    directoryClient = dryRun
      ? await createGoogleGroupsDryRunDirectoryClient(env, plannedOperations)
      : await createGoogleGroupsDirectoryClient(env);
  } catch (error) {
    if (dryRun) throw error;
    logError("google_groups_sync_auth_failed", { error: error instanceof Error ? error.message : String(error) });
    // Authentication is not an item failure. Leave every row due so a later
    // invocation can recover after credentials or the provider recover.
    return emptyResult(false);
  }

  const liveClaims = dryRun ? [] : await claimPendingGoogleGroupsSyncRows(db, limit);
  const claims = dryRun ? candidates : liveClaims;
  const liveClaimsById = new Map(liveClaims.map((claim) => [claim.id, claim]));
  if (claims.length === 0) return emptyResult(false);

  const memberEmails = await loadActionableGoogleGroupsSyncRows(db, claims);
  if (!dryRun) await supersedeStaleGoogleGroupsSyncClaims(db, liveClaims, new Set(memberEmails.keys()));

  let succeeded = 0;
  let failed = 0;
  let suppressed = 0;
  const completedAddsByUser: Record<string, string[]> = {};

  for (const claim of claims) {
    if (!memberEmails.has(claim.id)) continue;
    const liveClaim = liveClaimsById.get(claim.id);
    const memberEmail = memberEmails.get(claim.id);
    if (!memberEmail) {
      if (dryRun || (liveClaim && (await failGoogleGroupsSyncClaimForMissingUser(db, liveClaim)))) failed++;
      continue;
    }

    // A person who left this group on the provider side must not be re-added
    // by any queued work. Only an explicit resubscribe clears suppression.
    if (
      claim.action === "add_to_list" &&
      (await isGoogleGroupsSuppressed(db, claim.user_id, claim.google_group_email))
    ) {
      if (liveClaim) await supersedeSuppressedGoogleGroupsAdd(db, liveClaim);
      suppressed++;
      continue;
    }

    if (!(await isMailingListSyncEnabled(db, claim.google_group_email))) continue;
    try {
      await directoryClient.applyMembership({
        action: claim.action,
        googleGroupEmail: claim.google_group_email,
        memberEmail,
      });
      if (!liveClaim) {
        succeeded++;
        continue;
      }
      const notificationStatements = await prepareGoogleGroupsSyncNotificationStatements(
        db,
        liveClaim,
        memberEmail,
        syncPassId,
      );
      const completion = await completeGoogleGroupsDirectoryEffect(db, liveClaim, notificationStatements);
      if (!completion.finalizedClaim && !completion.fulfilledCurrentDesiredState) continue;

      succeeded++;
      if (claim.action === "add_to_list" && completion.fulfilledCurrentDesiredState) {
        (completedAddsByUser[claim.user_id] ??= []).push(claim.google_group_email);
      }
    } catch (error) {
      if (dryRun) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (!liveClaim) throw error;
      const outcome = await recordGoogleGroupsDirectoryFailure(db, liveClaim, message);
      logError("google_groups_sync_item_failed", {
        queueId: claim.id,
        error: message,
        attempts: outcome.attempts,
        deadLettered: outcome.deadLettered,
      });
      if (outcome.finalizedClaim) failed++;
    }
  }

  return {
    ...(dryRun ? { plannedOperations } : {}),
    processed: claims.length,
    succeeded,
    failed,
    suppressed,
    skippedUnconfigured: false,
    completedAddsByUser,
  };
}
