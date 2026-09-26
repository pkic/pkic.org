import type { MembershipFeeSyncResponse } from "../../../../../assets/shared/schemas/payment-settlements";
import { guardPermissionMutationDatabase } from "../../../auth/permissions";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import {
  fetchStripeCheckoutSession,
  fetchStripePaymentDetails,
  type StripeCheckoutSession,
} from "../../../integrations/stripe/payment-details";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../../types";
import { prepareAuditLog } from "../../audit";
import { dispatchStripePaymentEvent } from "../../payments/stripe-webhook";

interface FeeSyncRow {
  id: string;
  checkout_session_id: string | null;
  status: string;
  handling_required: number;
}

const AUTHORIZATION_CHANGED = "MEMBERSHIP_FEE_SYNC_AUTHORIZATION_CHANGED";

function authorizedSyncDb(db: DatabaseLike, actor: UserBackedAuthAdmin): DatabaseLike {
  return guardPermissionMutationDatabase(
    db,
    actor,
    [{ permission: "membership:write" }],
    () =>
      new AppError(
        409,
        AUTHORIZATION_CHANGED,
        "Membership payment permission changed while the reconciliation was being saved",
      ),
  );
}

function syncEventId(session: StripeCheckoutSession, eventType: string): string {
  return [
    "sync",
    session.id,
    eventType,
    session.status ?? "unknown",
    session.payment_status ?? "unknown",
    session.payment_intent ?? "none",
  ].join(":");
}

function responseOutcome(providerOutcome: string | null, status: string): MembershipFeeSyncResponse["outcome"] {
  if (providerOutcome === "rejected_mismatch") return "requires_review";
  if (status === "paid") return "paid";
  if (status === "failed") return "failed";
  if (status === "expired") return "expired";
  return "pending";
}

/** Fetch current Stripe evidence for one issued fee checkout and apply it through the canonical payment handler. */
export async function reconcileMembershipFee(
  db: DatabaseLike,
  env: Env,
  actor: UserBackedAuthAdmin,
  feeId: string,
  appBaseUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<MembershipFeeSyncResponse> {
  if (!env.STRIPE_SECRET_KEY) throw new AppError(503, "NOT_CONFIGURED", "STRIPE_SECRET_KEY is not configured");
  const fee = await first<FeeSyncRow>(
    db,
    `SELECT fee.id,
      COALESCE(fee.checkout_session_id, (
        SELECT checkout.provider_session_id FROM membership_fee_checkouts checkout
        WHERE checkout.fee_id = fee.id AND checkout.provider_session_id IS NOT NULL
        ORDER BY checkout.created_at DESC, checkout.id DESC LIMIT 1
      )) AS checkout_session_id,
      fee.status, fee.handling_required
     FROM membership_fee_intents fee WHERE fee.id = ? LIMIT 1`,
    [feeId],
  );
  if (!fee) throw new AppError(404, "MEMBERSHIP_FEE_NOT_FOUND", "Membership fee not found");
  if (!fee.checkout_session_id)
    throw new AppError(409, "MEMBERSHIP_CHECKOUT_NOT_ISSUED", "This fee has no Stripe checkout session to reconcile");

  const sessionResult = await fetchStripeCheckoutSession(env.STRIPE_SECRET_KEY, fee.checkout_session_id, fetcher);
  if (!sessionResult.ok)
    throw new AppError(502, "STRIPE_SYNC_FAILED", "The current checkout state could not be retrieved from Stripe");
  const session = sessionResult.value;
  if (session.id !== fee.checkout_session_id)
    throw new AppError(502, "STRIPE_SESSION_MISMATCH", "Stripe returned a different checkout session");

  let eventType: string | null = null;
  if (session.status === "expired") {
    eventType = "checkout.session.expired";
  } else if (session.status === "complete" && session.payment_status === "paid") {
    eventType = "checkout.session.completed";
  } else if (session.status === "complete") {
    if (session.payment_intent) {
      const details = await fetchStripePaymentDetails(env.STRIPE_SECRET_KEY, session.payment_intent, fetcher);
      if (!details.ok)
        throw new AppError(502, "STRIPE_SYNC_FAILED", "The current payment state could not be retrieved from Stripe");
      eventType = details.value.paymentFailed ? "checkout.session.async_payment_failed" : "checkout.session.completed";
    } else {
      eventType = "checkout.session.completed";
    }
  }

  const authorizedDb = authorizedSyncDb(db, actor);
  let providerOutcome: string | null = null;
  if (eventType) {
    const event = {
      id: syncEventId(session, eventType),
      type: eventType,
      created: Math.floor(Date.now() / 1000),
      data: { object: session },
    };
    const result = await dispatchStripePaymentEvent(authorizedDb, env, event, appBaseUrl, () => undefined);
    providerOutcome = "outcome" in result && typeof result.outcome === "string" ? result.outcome : null;
  }

  const updated =
    (await first<Pick<FeeSyncRow, "status" | "handling_required">>(
      authorizedDb,
      "SELECT status, handling_required FROM membership_fee_intents WHERE id = ?",
      [fee.id],
    )) ?? fee;
  const outcome = responseOutcome(providerOutcome, updated.status);
  const syncedAt = new Date().toISOString();
  await authorizedDb.batch([
    prepareAuditLog(
      authorizedDb,
      "admin",
      actor.id,
      "membership_fee_reconciled",
      "membership_fee",
      fee.id,
      {
        checkoutSessionId: session.id,
        stripeSessionStatus: session.status ?? null,
        stripePaymentStatus: session.payment_status ?? null,
        outcome,
      },
      syncedAt,
    ),
  ]);

  return {
    feeId: fee.id,
    sessionId: session.id,
    outcome,
    status: updated.status,
    handlingRequired: updated.handling_required === 1 || outcome === "requires_review",
    syncedAt,
  };
}
