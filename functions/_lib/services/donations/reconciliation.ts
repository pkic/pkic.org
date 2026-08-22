import type { DonationSyncRequest, DonationSyncResponse } from "../../../../assets/shared/schemas/admin-donations";
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
  options: { stripeKey: string; appBaseUrl: string; limit: number },
): Promise<DonationReconciliationResult> {
  const donations = await selectReconciliationRows(db, request, options.limit);
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
        await backfillCompletedDonation(db, session, details.value);
        results.push({ sessionId, outcome: "completed" });
        continue;
      }

      if (session.status === "expired") {
        await markDonationExpired(db, sessionId);
        await queueNotification(db, env, sessionId, "expired", options.appBaseUrl, outboxIds);
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
          await completeDonationFromStripe(db, session, emptyDetails());
          await queueNotification(db, env, sessionId, "thank_you", options.appBaseUrl, outboxIds);
          results.push({ sessionId, outcome: "completed" });
          continue;
        }
        results.push({ sessionId, outcome: "error", error: "Failed to fetch payment details from Stripe" });
        continue;
      }
      const details = detailsResult.value;

      if (session.status === "complete" && session.payment_status === "paid") {
        await completeDonationFromStripe(db, session, details);
        await queueNotification(db, env, sessionId, "thank_you", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "completed" });
      } else if (session.status === "complete" && details.paymentFailed) {
        await markDonationFailed(db, sessionId, details.paymentMethodType);
        await queueNotification(db, env, sessionId, "payment_failed", options.appBaseUrl, outboxIds);
        results.push({ sessionId, outcome: "failed" });
      } else if (session.status === "complete") {
        await markDonationAwaitingPayment(db, sessionId, details.paymentMethodType, session.expires_at ?? null);
        results.push({ sessionId, outcome: "awaiting_payment" });
      } else {
        if (details.paymentMethodType) {
          await recordDonationPaymentMethod(db, sessionId, details.paymentMethodType);
        }
        results.push({ sessionId, outcome: "still_pending" });
      }
    } catch {
      results.push({
        sessionId,
        outcome: "error",
        error: "Donation reconciliation failed",
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
