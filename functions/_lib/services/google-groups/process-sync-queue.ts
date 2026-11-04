import { OWN_EMAIL_ADDRESS_LIMIT } from "../../../../assets/shared/schemas/own-email-addresses";
import { googleGroupsDeliverySql } from "./delivery-policy";
import { all, first } from "../../db/queries";
import { recordProviderAbsence, recordProviderPresences } from "./observe-membership";
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

  const memberships = new Map<string, Awaited<ReturnType<typeof directoryClient.listMembers>>>();
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
      claim.action !== "remove_from_list" &&
      (await isGoogleGroupsSuppressed(db, claim.user_id, claim.google_group_email))
    ) {
      if (liveClaim) await supersedeSuppressedGoogleGroupsAdd(db, liveClaim);
      suppressed++;
      continue;
    }

    if (!(await isMailingListSyncEnabled(db, claim.google_group_email))) continue;
    let membershipWasAbsent = false;
    try {
      if (claim.action !== "remove_from_list") {
        const confirmed = await first(
          db,
          `SELECT 1 FROM google_groups_observed_membership
          WHERE user_id = ? AND google_group_email = ? AND confirmed_subscribed_at IS NOT NULL`,
          [claim.user_id, claim.google_group_email],
        );
        if (confirmed || claim.action === "add_to_list") {
          let listing = memberships.get(claim.google_group_email);
          if (!listing) {
            listing = await directoryClient.listMembers(claim.google_group_email);
            memberships.set(claim.google_group_email, listing);
          }
          if (!listing.complete) throw new Error("Incomplete provider membership listing; queued addition stopped");
          membershipWasAbsent = !listing.emails.includes(memberEmail.toLowerCase());
          if (confirmed && membershipWasAbsent) {
            if (!dryRun) await recordProviderAbsence(db, claim.user_id, claim.google_group_email);
            if (liveClaim) await supersedeSuppressedGoogleGroupsAdd(db, liveClaim);
            suppressed++;
            continue;
          }
        }
      }
      const projection = await first<{ delivery: "all" | "none" | null }>(
        db,
        `WITH input(action,user_id,email) AS (VALUES (?,?,?))
         SELECT ${googleGroupsDeliverySql("input.action", "input.user_id", "input.email")} AS delivery FROM input`,
        [claim.action, claim.user_id, claim.google_group_email],
      );
      const delivery = projection?.delivery ?? undefined;
      // Delivery belongs to this same durable intent, including verified additional addresses.
      const aliases = await all<{ email: string }>(
        db,
        "SELECT lower(email) AS email FROM user_emails WHERE user_id = ? AND verified_at IS NOT NULL AND lower(email) != lower(?) ORDER BY id LIMIT ?",
        [claim.user_id, memberEmail, OWN_EMAIL_ADDRESS_LIMIT + 1],
      );
      if (aliases.length > OWN_EMAIL_ADDRESS_LIMIT) throw new Error("Verified addresses exceed the account limit");
      const notificationStatements =
        liveClaim && membershipWasAbsent
          ? prepareGoogleGroupsSyncNotificationStatements(db, liveClaim, syncPassId)
          : [];
      if (notificationStatements.length) await db.batch(notificationStatements);
      await directoryClient.applyMembership({
        action: claim.action,
        googleGroupEmail: claim.google_group_email,
        memberEmail,
        ...(delivery ? { delivery } : {}),
      });
      for (const alias of aliases) {
        await directoryClient.applyMembership({
          action: claim.action === "remove_from_list" ? "remove_from_list" : "add_to_list",
          googleGroupEmail: claim.google_group_email,
          memberEmail: alias.email,
          ...(claim.action === "remove_from_list" ? {} : { delivery: "none" as const }),
        });
      }
      if (!liveClaim) {
        succeeded++;
        continue;
      }
      const completion = await completeGoogleGroupsDirectoryEffect(db, liveClaim, [], delivery);
      if (!completion.finalizedClaim && !completion.fulfilledCurrentDesiredState) continue;

      succeeded++;
      if (claim.action !== "remove_from_list" && completion.fulfilledCurrentDesiredState) {
        await recordProviderPresences(db, claim.google_group_email, [{ userId: claim.user_id, email: memberEmail }]);
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
