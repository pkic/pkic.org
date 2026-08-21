import { first, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike } from "../../types";
import type { StripeCheckoutSession, StripePaymentDetails } from "../../integrations/stripe/payment-details";

export interface DonationRecord {
  id: string;
  checkout_session_id: string;
  status: string;
  name: string;
  email: string;
  organization: string | null;
  currency: string;
  gross_amount: number;
}

export interface StripeDonorIdentity {
  name: string | null;
  email: string | null;
  organization: string | null;
  source: string | null;
}

export async function getDonationBySession(db: DatabaseLike, sessionId: string): Promise<DonationRecord | null> {
  return first<DonationRecord>(
    db,
    `SELECT id, checkout_session_id, status, name, email, organization, currency, gross_amount
     FROM donations WHERE checkout_session_id = ? LIMIT 1`,
    [sessionId],
  );
}

export async function markDonationAwaitingPayment(
  db: DatabaseLike,
  sessionId: string,
  paymentMethodType: string | null,
  expiresAt: number | null,
): Promise<DonationRecord | null> {
  await run(
    db,
    `UPDATE donations
     SET status = 'awaiting_payment',
         payment_method_type = COALESCE(payment_method_type, ?),
         session_expires_at = COALESCE(session_expires_at, ?)
     WHERE checkout_session_id = ? AND status = 'pending'`,
    [paymentMethodType, expiresAt, sessionId],
  );
  return getDonationBySession(db, sessionId);
}

export async function markDonationFailed(
  db: DatabaseLike,
  sessionId: string,
  paymentMethodType: string | null = null,
): Promise<DonationRecord | null> {
  await run(
    db,
    `UPDATE donations
     SET status = 'failed', payment_method_type = COALESCE(payment_method_type, ?)
     WHERE checkout_session_id = ? AND status <> 'completed'`,
    [paymentMethodType, sessionId],
  );
  return getDonationBySession(db, sessionId);
}

export async function markDonationExpired(db: DatabaseLike, sessionId: string): Promise<DonationRecord | null> {
  await run(db, "UPDATE donations SET status = 'expired' WHERE checkout_session_id = ? AND status = 'pending'", [
    sessionId,
  ]);
  return getDonationBySession(db, sessionId);
}

export async function completeDonationFromStripe(
  db: DatabaseLike,
  session: StripeCheckoutSession,
  details: StripePaymentDetails,
  identity: StripeDonorIdentity | null = null,
): Promise<DonationRecord | null> {
  const completedAt = nowIso();
  const updated = await run(
    db,
    `UPDATE donations
     SET payment_intent_id = COALESCE(?, payment_intent_id),
         net_amount = COALESCE(?, net_amount),
         completed_at = COALESCE(completed_at, ?),
         status = 'completed',
         payment_method_type = COALESCE(payment_method_type, ?),
         settled_amount = COALESCE(?, settled_amount),
         settled_currency = COALESCE(?, settled_currency),
         name = CASE WHEN ? IS NOT NULL AND (name IS NULL OR TRIM(name) = '' OR name = 'Unknown') THEN ? ELSE name END,
         email = CASE WHEN ? IS NOT NULL AND (email IS NULL OR TRIM(email) = '') THEN ? ELSE email END,
         organization = CASE WHEN ? IS NOT NULL AND (organization IS NULL OR TRIM(organization) = '') THEN ? ELSE organization END,
         source = CASE WHEN ? IS NOT NULL AND (source IS NULL OR TRIM(source) = '') THEN ? ELSE source END
     WHERE checkout_session_id = ?`,
    [
      session.payment_intent,
      details.netAmount,
      completedAt,
      details.paymentMethodType,
      details.settledAmount,
      details.settledCurrency,
      identity?.name ?? null,
      identity?.name ?? null,
      identity?.email ?? null,
      identity?.email ?? null,
      identity?.organization ?? null,
      identity?.organization ?? null,
      identity?.source ?? null,
      identity?.source ?? null,
      session.id,
    ],
  );

  if (updated.changes === 0) {
    await run(
      db,
      `INSERT OR IGNORE INTO donations
         (id, checkout_session_id, payment_intent_id, name, email, organization, currency,
          gross_amount, net_amount, source, completed_at, status, payment_method_type,
          settled_amount, settled_currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      [
        uuid(),
        session.id,
        session.payment_intent,
        identity?.name ?? "Unknown",
        identity?.email ?? session.customer_email ?? "",
        identity?.organization ?? null,
        session.currency ?? "usd",
        session.amount_total ?? 0,
        details.netAmount,
        identity?.source ?? null,
        completedAt,
        details.paymentMethodType,
        details.settledAmount,
        details.settledCurrency,
      ],
    );
  }
  return getDonationBySession(db, session.id);
}

export async function backfillCompletedDonation(
  db: DatabaseLike,
  session: StripeCheckoutSession,
  details: StripePaymentDetails,
): Promise<DonationRecord | null> {
  await run(
    db,
    `UPDATE donations
     SET net_amount = COALESCE(net_amount, ?),
         payment_method_type = COALESCE(payment_method_type, ?),
         payment_intent_id = COALESCE(payment_intent_id, ?),
         settled_amount = COALESCE(settled_amount, ?),
         settled_currency = COALESCE(settled_currency, ?)
     WHERE checkout_session_id = ? AND status = 'completed'`,
    [
      details.netAmount,
      details.paymentMethodType,
      session.payment_intent,
      details.settledAmount,
      details.settledCurrency,
      session.id,
    ],
  );
  return getDonationBySession(db, session.id);
}

export async function recordDonationPaymentMethod(
  db: DatabaseLike,
  sessionId: string,
  paymentMethodType: string,
): Promise<void> {
  await run(
    db,
    `UPDATE donations
     SET payment_method_type = COALESCE(payment_method_type, ?)
     WHERE checkout_session_id = ? AND status <> 'completed'`,
    [paymentMethodType, sessionId],
  );
}
