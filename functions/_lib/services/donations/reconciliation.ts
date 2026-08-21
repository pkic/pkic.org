import type { DonationSyncRequest, DonationSyncResponse } from "../../../../assets/shared/schemas/admin-donations";
import { all } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import {
  fetchStripeCheckoutSession,
  fetchStripePaymentDetails,
  type StripePaymentDetails,
} from "../../integrations/stripe/payment-details";
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
import type { DatabaseLike, Env } from "../../types";

interface ReconciliationRow extends DonationRecord {
  created_at: string;
}

export interface DonationReconciliationResult {
  response: DonationSyncResponse;
  outboxIds: string[];
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
): Promise<StripePaymentDetails> {
  if (!paymentIntentId) return emptyDetails(offeredMethod);
  const details = await fetchStripePaymentDetails(stripeKey, paymentIntentId);
  return { ...details, paymentMethodType: details.paymentMethodType ?? offeredMethod };
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
  options: { stripeKey: string; appBaseUrl: string; limit: number },
): Promise<DonationReconciliationResult> {
  const donations = await selectReconciliationRows(db, request, options.limit);
  const results: DonationSyncResponse["results"] = [];
  const outboxIds: string[] = [];

  // Deliberately sequential: the bounded route should not burst Stripe API calls.
  for (const donation of donations) {
    const sessionId = donation.checkout_session_id;
    try {
      const session = await fetchStripeCheckoutSession(options.stripeKey, sessionId);
      if (!session) {
        results.push({ sessionId, outcome: "error", error: "Failed to fetch session from Stripe" });
        continue;
      }

      if (donation.status === "completed") {
        const details = await loadPaymentDetails(options.stripeKey, session.payment_intent);
        await backfillCompletedDonation(db, session, details);
        results.push({ sessionId, outcome: "completed" });
        continue;
      }

      if (session.status === "complete" && session.payment_status === "paid") {
        const details = await loadPaymentDetails(options.stripeKey, session.payment_intent);
        await completeDonationFromStripe(db, session, details);
        await queueNotification(db, env, sessionId, "thank_you", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "completed" });
        continue;
      }

      if (session.status === "complete") {
        const offeredMethod = session.payment_method_types?.[0] ?? null;
        const details = await loadPaymentDetails(options.stripeKey, session.payment_intent, offeredMethod);
        if (details.paymentFailed) {
          await markDonationFailed(db, sessionId, details.paymentMethodType);
          await queueNotification(db, env, sessionId, "payment_failed", options.appBaseUrl, outboxIds);
          results.push({ sessionId, outcome: "failed" });
        } else {
          await markDonationAwaitingPayment(db, sessionId, details.paymentMethodType, session.expires_at ?? null);
          results.push({ sessionId, outcome: "awaiting_payment" });
        }
        continue;
      }

      if (session.status === "expired") {
        await markDonationExpired(db, sessionId);
        await queueNotification(db, env, sessionId, "expired", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "expired" });
        continue;
      }

      const details = await loadPaymentDetails(options.stripeKey, session.payment_intent);
      if (details.paymentFailed) {
        await markDonationFailed(db, sessionId, details.paymentMethodType);
        await queueNotification(db, env, sessionId, "payment_failed", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "failed" });
      } else {
        if (details.paymentMethodType) {
          await recordDonationPaymentMethod(db, sessionId, details.paymentMethodType);
        }
        results.push({ sessionId, outcome: "still_pending" });
      }
    } catch (error) {
      results.push({
        sessionId,
        outcome: "error",
        error: error instanceof Error ? error.message : "Unknown reconciliation error",
      });
    }
  }

  const count = (outcome: DonationSyncResponse["results"][number]["outcome"]) =>
    results.filter((result) => result.outcome === outcome).length;
  return {
    response: {
      synced: donations.length,
      completed: count("completed"),
      awaitingPayment: count("awaiting_payment"),
      expired: count("expired"),
      failed: count("failed"),
      errors: count("error"),
      results,
    },
    outboxIds,
  };
}
