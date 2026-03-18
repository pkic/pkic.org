/**
 * POST /api/v1/webhooks/stripe
 *
 * Handles Stripe webhook events. Currently processes:
 *   - checkout.session.completed — marks a donation as paid and stores the
 *     net amount (gross minus Stripe fee) for tax reporting.
 *
 * Signature verification uses HMAC-SHA256 via the Web Crypto API (no SDK).
 * The tolerance window is 300 seconds (Stripe's recommendation).
 *
 * Required Stripe webhook events to configure in the Dashboard:
 *   checkout.session.completed
 *
 * Wrangler secret: STRIPE_WEBHOOK_SECRET (whsec_…)
 */

import { json } from "../../../_lib/http";
import { queueEmail, processOutboxByIdBackground } from "../../../_lib/email/outbox";
import type { PagesContext } from "../../../_lib/types";

const TOLERANCE_SECONDS = 300;

/**
 * Verify a Stripe webhook signature using HMAC-SHA256.
 * https://stripe.com/docs/webhooks/signatures
 */
async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(",")) {
    const idx = part.indexOf("=");
    if (idx !== -1) {
      parts[part.slice(0, idx)] = part.slice(idx + 1);
    }
  }

  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(signedPayload);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, msgData);
  const computed = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison to prevent timing attacks
  if (computed.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
}

interface StripeCheckoutSession {
  id: string;
  object: "checkout.session";
  payment_intent: string | null;
  amount_total: number | null;
  currency: string;
  customer_email: string | null;
}

interface StripeBalanceTransaction {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
}

interface StripePaymentIntent {
  id: string;
  latest_charge: string | null;
}

interface StripeCharge {
  id: string;
  balance_transaction: string | null;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return json({ error: "Webhook not configured" }, 503);
  }

  // ── Read raw body (must be done before any parsing) ───────────────────────
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature") ?? "";

  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.warn("Stripe webhook signature verification failed");
    return json({ error: "Invalid signature" }, 400);
  }

  // ── Parse event ───────────────────────────────────────────────────────────
  let event: { type: string; data: { object: unknown } };
  try {
    event = JSON.parse(rawBody) as { type: string; data: { object: unknown } };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    // Acknowledge other events without processing them
    return json({ received: true });
  }

  const session = event.data.object as StripeCheckoutSession;

  // ── Fetch net amount from Stripe ──────────────────────────────────────────
  // Gross amount is stored at checkout time. We look up the balance transaction
  // to get the net amount (gross minus Stripe's processing fee).
  let netAmount: number | null = null;
  if (env.STRIPE_SECRET_KEY && session.payment_intent) {
    try {
      netAmount = await fetchNetAmount(env.STRIPE_SECRET_KEY, session.payment_intent);
    } catch (err) {
      // Non-fatal — we record null and can back-fill from Stripe export
      console.error("Failed to fetch net amount for PI", session.payment_intent, err);
    }
  }

  // ── Update donation record ───────────────────────────────────────────────
  const completedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE donations
     SET payment_intent_id = ?,
         net_amount        = ?,
         completed_at      = ?
     WHERE checkout_session_id = ?`,
  )
    .bind(
      session.payment_intent ?? null,
      netAmount,
      completedAt,
      session.id,
    )
    .run();

  // Read back the donor record so we can address the thank-you email correctly.
  interface DonorRow {
    donor_name: string;
    donor_email: string;
    donor_organization: string | null;
    currency: string;
    gross_amount: number;
  }

  let donor: DonorRow | null = null;
  if (result.meta?.changes !== 0) {
    donor = await env.DB.prepare(
      `SELECT donor_name, donor_email, donor_organization, currency, gross_amount
       FROM donations WHERE checkout_session_id = ?`,
    )
      .bind(session.id)
      .first<DonorRow>();
  }

  if (!result.meta || result.meta.changes === 0) {
    // Session wasn't in our DB — could be a race condition or a session created
    // directly in the payment processor's Dashboard.
    const donationId = crypto.randomUUID();
    const fallbackCurrency = session.currency ?? "usd";
    const fallbackGross = session.amount_total ?? 0;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO donations
         (id, checkout_session_id, payment_intent_id,
          donor_name, donor_email, currency, gross_amount, net_amount, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        donationId,
        session.id,
        session.payment_intent ?? null,
        "Unknown",                          // name unknown for Dashboard-created sessions
        session.customer_email ?? null,
        fallbackCurrency,
        fallbackGross,
        netAmount,
        completedAt,
      )
      .run();

    if (session.customer_email) {
      donor = {
        donor_name: "Unknown",
        donor_email: session.customer_email,
        donor_organization: null,
        currency: fallbackCurrency,
        gross_amount: fallbackGross,
      };
    }
  }

  // ── Send thank-you email ─────────────────────────────────────────────────
  if (donor?.donor_email) {
    try {
      const formattedAmount = formatMajorAmount(donor.gross_amount, donor.currency);
      const firstName = donor.donor_name !== "Unknown" ? (donor.donor_name.split(" ")[0] ?? "") : "";
      const bcc = env.DONATION_NOTIFICATION_EMAIL ? [env.DONATION_NOTIFICATION_EMAIL] : [];

      const outboxId = await queueEmail(env.DB, {
        templateKey: "donation_thank_you",
        recipientEmail: donor.donor_email,
        messageType: "transactional",
        subject: "Thank you for your donation to the PKI Consortium",
        data: {
          firstName,
          name: donor.donor_name,
          email: donor.donor_email,
          organizationName: donor.donor_organization ?? "",
          currency: donor.currency.toUpperCase(),
          formattedAmount,
          donateUrl: "https://pkic.org/donate/",
          ...(bcc.length > 0 ? { __bccRecipients: bcc } : {}),
        },
      });
      context.waitUntil(processOutboxByIdBackground(env.DB, env, outboxId));
    } catch (err) {
      // Non-fatal — payment is already recorded; log and continue
      console.error("Failed to queue donation thank-you email", err);
    }
  }

  return json({ received: true });
}

/**
 * Format a smallest-unit amount to a human-readable string (e.g. "$50.00").
 * Used server-side in email templates where the currencies TS module is unavailable.
 */
function formatMajorAmount(smallestUnit: number, currencyCode: string): string {
  // Zero-decimal currencies (JPY, KRW, …) — amount is already in major units
  const zeroDecimalCurrencies = new Set([
    "bif", "clp", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf",
    "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
  ]);
  const isZeroDecimal = zeroDecimalCurrencies.has(currencyCode.toLowerCase());
  const majorAmount = isZeroDecimal ? smallestUnit : smallestUnit / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
    }).format(majorAmount);
  } catch {
    return `${majorAmount} ${currencyCode.toUpperCase()}`;
  }
}

/**
 * Fetches the net amount for a payment intent by traversing:
 *   PaymentIntent → latest_charge → balance_transaction → net
 */
async function fetchNetAmount(stripeKey: string, paymentIntentId: string): Promise<number | null> {
  const headers = {
    "Authorization": `Bearer ${stripeKey}`,
  };

  const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, { headers });
  if (!piRes.ok) return null;

  const pi = (await piRes.json()) as StripePaymentIntent;
  if (!pi.latest_charge) return null;

  const chargeRes = await fetch(`https://api.stripe.com/v1/charges/${pi.latest_charge}`, { headers });
  if (!chargeRes.ok) return null;

  const charge = (await chargeRes.json()) as StripeCharge;
  if (!charge.balance_transaction) return null;

  const btRes = await fetch(`https://api.stripe.com/v1/balance_transactions/${charge.balance_transaction}`, { headers });
  if (!btRes.ok) return null;

  const bt = (await btRes.json()) as StripeBalanceTransaction;
  return bt.net ?? null;
}
