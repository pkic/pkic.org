import { logError, logInfo } from "../../logging";
import type { DatabaseLike } from "../../types";
import type { GoogleServiceAccountEnv, ProcessGoogleGroupsSyncResult } from "./contracts";
import { createGoogleGroupsDirectoryClient, isGoogleGroupsSyncConfigured } from "./directory-client";
import {
  claimPendingGoogleGroupsSyncRows,
  completeGoogleGroupsDirectoryEffect,
  listPendingGoogleGroupsSync,
  loadActionableGoogleGroupsSyncClaims,
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
): Promise<ProcessGoogleGroupsSyncResult> {
  if (!isGoogleGroupsSyncConfigured(env)) {
    logInfo("google_groups_sync_skipped_unconfigured", {
      reason:
        "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / GOOGLE_WORKSPACE_ADMIN_EMAIL not configured",
    });
    return emptyResult(true);
  }

  // Avoid signing a JWT and making an OAuth request when no durable work is due.
  if ((await listPendingGoogleGroupsSync(db, limit)).length === 0) return emptyResult(false);

  let directoryClient;
  try {
    directoryClient = await createGoogleGroupsDirectoryClient(env);
  } catch (error) {
    logError("google_groups_sync_auth_failed", { error: error instanceof Error ? error.message : String(error) });
    // Authentication is not an item failure. Leave every row due so a later
    // invocation can recover after credentials or the provider recover.
    return emptyResult(false);
  }

  const claims = await claimPendingGoogleGroupsSyncRows(db, limit);
  if (claims.length === 0) return emptyResult(false);

  const memberEmails = await loadActionableGoogleGroupsSyncClaims(db, claims);
  await supersedeStaleGoogleGroupsSyncClaims(db, claims, new Set(memberEmails.keys()));

  let succeeded = 0;
  let failed = 0;
  const completedAddsByUser: Record<string, string[]> = {};

  for (const claim of claims) {
    const memberEmail = memberEmails.get(claim.id);
    if (!memberEmail) continue;
    try {
      await directoryClient.applyMembership({
        action: claim.action,
        googleGroupEmail: claim.google_group_email,
        memberEmail,
      });
      const completion = await completeGoogleGroupsDirectoryEffect(db, claim);
      if (!completion.finalizedClaim && !completion.fulfilledCurrentDesiredState) continue;

      succeeded++;
      if (claim.action === "add_to_list" && completion.fulfilledCurrentDesiredState) {
        (completedAddsByUser[claim.user_id] ??= []).push(claim.google_group_email);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await recordGoogleGroupsDirectoryFailure(db, claim, message);
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
    processed: claims.length,
    succeeded,
    failed,
    skippedUnconfigured: false,
    completedAddsByUser,
  };
}
