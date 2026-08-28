import type { DonationSyncRequest, DonationSyncResponse } from "../../../../assets/shared/schemas/donation-management";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { guardDatabaseBatches } from "../../db/guarded-database";
import { all } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import {
  fetchStripeCheckoutSession,
  fetchStripePaymentDetails,
  type StripePaymentDetails,
} from "../../integrations/stripe/payment-details";
import type { ProviderResult } from "../../integrations/provider-failure";
import {
  backfillCompletedDonation,
  completeDonationFromStripe,
  markDonationAwaitingPayment,
  markDonationExpired,
  markDonationFailed,
  recordDonationPaymentMethod,
  type DonationRecord,
} from "./lifecycle";
import { queueDonationNotification } from "./notifications";
import { AppError, isAppError } from "../../errors";
import { prepareAuditLog } from "../audit";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";

interface ReconciliationRow extends DonationRecord {
  created_at: string;
}

export interface DonationReconciliationResult {
  response: DonationSyncResponse;
  outboxIds: string[];
}

const DONATION_SYNC_AUTHORIZATION_CHANGED = "DONATION_SYNC_AUTHORIZATION_CHANGED";

function authorizedReconciliationDb(db: DatabaseLike, actor: UserBackedAuthAdmin): DatabaseLike {
  return guardDatabaseBatches(db, async (statements) => {
    try {
      const [, ...results] = await db.batch([
        preparePermissionsAuthorizationGuard(db, actor, [{ permission: "donations:sync" }]),
        ...statements,
      ]);
      return results;
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(
          409,
          DONATION_SYNC_AUTHORIZATION_CHANGED,
          "Donation reconciliation permission changed while the update was being saved",
        );
      }
      throw error;
    }
  });
}

function isAuthorizationChange(error: unknown): boolean {
  return isAppError(error) && error.code === DONATION_SYNC_AUTHORIZATION_CHANGED;
}

function emptyDetails(paymentMethodType: string | null = null): StripePaymentDetails {
  return {
    netAmount: null,
    settledAmount: null,
    settledCurrency: null,
    paymentMethodType,
    paymentFailed: false,
  };
}

async function loadPaymentDetails(
  stripeKey: string,
  paymentIntentId: string | null,
  offeredMethod: string | null = null,
): Promise<ProviderResult<StripePaymentDetails>> {
  if (!paymentIntentId) return { ok: true, value: emptyDetails(offeredMethod) };
  const result = await fetchStripePaymentDetails(stripeKey, paymentIntentId);
  return result.ok
    ? { ok: true, value: { ...result.value, paymentMethodType: result.value.paymentMethodType ?? offeredMethod } }
    : result;
}

async function selectReconciliationRows(
  db: DatabaseLike,
  request: DonationSyncRequest,
  limit: number,
): Promise<ReconciliationRow[]> {
  const conditions = [
    request.pendingOnly
      ? "status IN ('pending', 'awaiting_payment')"
      : `(status IN ('pending', 'awaiting_payment')
          OR (status = 'completed' AND (net_amount IS NULL OR payment_method_type IS NULL)))`,
  ];
  const bindings: unknown[] = [];
  if (request.sessionIds) {
    const filter = buildD1JsonMembershipFilter("checkout_session_id", request.sessionIds);
    conditions.unshift(filter.sql);
    bindings.push(...filter.bindings);
  }
  bindings.push(limit);

  return all<ReconciliationRow>(
    db,
    `SELECT id, checkout_session_id, status, name, email, organization, currency, gross_amount, created_at
     FROM donations
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    bindings,
  );
}

async function queueNotification(
  db: DatabaseLike,
  env: Env,
  sessionId: string,
  kind: "thank_you" | "payment_failed" | "expired",
  appBaseUrl: string,
  outboxIds: string[],
): Promise<void> {
  const id = await queueDonationNotification(db, env, sessionId, kind, appBaseUrl);
  if (id) outboxIds.push(id);
}

/** Bounded Stripe reconciliation; D1 selects and filters before external I/O. */
export async function reconcileDonations(
  db: DatabaseLike,
  env: Env,
  request: DonationSyncRequest,
  options: { stripeKey: string; appBaseUrl: string; limit: number; actor: UserBackedAuthAdmin },
): Promise<DonationReconciliationResult> {
  const authorizedDb = authorizedReconciliationDb(db, options.actor);
  const donations = await selectReconciliationRows(authorizedDb, request, options.limit);
  const results: DonationSyncResponse["results"] = [];
  const outboxIds: string[] = [];

  // Deliberately sequential: the bounded route should not burst Stripe API calls.
  for (const donation of donations) {
    const sessionId = donation.checkout_session_id;
    try {
      const sessionResult = await fetchStripeCheckoutSession(options.stripeKey, sessionId);
      if (!sessionResult.ok) {
        results.push({ sessionId, outcome: "error", error: "Failed to fetch session from Stripe" });
        continue;
      }
      const session = sessionResult.value;

      if (donation.status === "completed") {
        const details = await loadPaymentDetails(options.stripeKey, session.payment_intent);
        if (!details.ok) {
          results.push({ sessionId, outcome: "error", error: "Failed to fetch payment details from Stripe" });
          continue;
        }
        await backfillCompletedDonation(authorizedDb, session, details.value);
        results.push({ sessionId, outcome: "completed" });
        continue;
      }

      if (session.status === "expired") {
        await markDonationExpired(authorizedDb, sessionId);
        await queueNotification(authorizedDb, env, sessionId, "expired", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "expired" });
        continue;
      }

      const detailsResult = await loadPaymentDetails(
        options.stripeKey,
        session.payment_intent,
        session.status === "complete" ? (session.payment_method_types?.[0] ?? null) : null,
      );
      if (!detailsResult.ok) {
        if (session.status === "complete" && session.payment_status === "paid") {
          // A directly fetched paid Checkout Session is authoritative. The
          // expanded payment-intent data is supplemental and backfillable.
          await completeDonationFromStripe(authorizedDb, session, emptyDetails());
          await queueNotification(authorizedDb, env, sessionId, "thank_you", options.appBaseUrl, outboxIds);
          results.push({ sessionId, outcome: "completed" });
          continue;
        }
        results.push({ sessionId, outcome: "error", error: "Failed to fetch payment details from Stripe" });
        continue;
      }
      const details = detailsResult.value;

      if (session.status === "complete" && session.payment_status === "paid") {
        await completeDonationFromStripe(authorizedDb, session, details);
        await queueNotification(authorizedDb, env, sessionId, "thank_you", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "completed" });
      } else if (session.status === "complete" && details.paymentFailed) {
        await markDonationFailed(authorizedDb, sessionId, details.paymentMethodType);
        await queueNotification(authorizedDb, env, sessionId, "payment_failed", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "failed" });
      } else if (session.status === "complete") {
        await markDonationAwaitingPayment(
          authorizedDb,
          sessionId,
          details.paymentMethodType,
          session.expires_at ?? null,
        );
        results.push({ sessionId, outcome: "awaiting_payment" });
      } else {
        if (details.paymentMethodType) {
          await recordDonationPaymentMethod(authorizedDb, sessionId, details.paymentMethodType);
        }
        results.push({ sessionId, outcome: "still_pending" });
      }
    } catch (error) {
      if (isAuthorizationChange(error)) throw error;
      results.push({
        sessionId,
        outcome: "error",
        error: "Donation reconciliation failed",
      });
    }
  }

  const count = (outcome: DonationSyncResponse["results"][number]["outcome"]) =>
    results.filter((result) => result.outcome === outcome).length;
  const response = {
    synced: donations.length,
    completed: count("completed"),
    awaitingPayment: count("awaiting_payment"),
    expired: count("expired"),
    failed: count("failed"),
    errors: count("error"),
    results,
  } satisfies DonationSyncResponse;
  await authorizedDb.batch([
    prepareAuditLog(authorizedDb, "admin", options.actor.id, "donations_reconciled", "donation_reconciliation", null, {
      requestedSessionCount: request.sessionIds?.length ?? null,
      pendingOnly: request.pendingOnly ?? false,
      ...response,
    }),
  ]);
  return {
    response,
    outboxIds,
  };
}
