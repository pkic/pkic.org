/**
 * POST /api/v1/webhooks/stripe
 *
 * Handles Stripe webhook events. Currently processes:
 *   - checkout.session.completed              — marks a donation as paid and
 *     stores the net amount (gross minus Stripe fee) for tax reporting.
 *   - checkout.session.async_payment_succeeded — delayed-payment confirmation
 *     (bank transfer / ACH / SEPA); treated identically to .completed.
 *   - checkout.session.expired                — marks a donation as expired
 *     and emails the donor with a link to retry.
 *   - checkout.session.async_payment_failed   — delayed payment bounced;
 *     marks as 'failed' and emails the donor.
 *
 * Signature verification uses HMAC-SHA256 via the Web Crypto API (no SDK).
 * The tolerance window is 300 seconds (Stripe's recommendation).
 *
 * Required Stripe webhook events to configure in the Dashboard:
 *   checkout.session.completed
 *   checkout.session.async_payment_succeeded
 *   checkout.session.async_payment_failed
 *   checkout.session.expired
 *
 * Wrangler secret: STRIPE_WEBHOOK_SECRET (whsec_…)
 */

import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";
import { buildBadgeAttachment } from "../../../_lib/email/attachments";
import { queueEmail, processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { prerenderDonationBadge } from "../../../_lib/services/og-badge-prerender";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { getOrCreatePromoterCode } from "../donations/promoter";
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
  payment_method_types?: string[] | null;
  expires_at?: number | null;
  amount_total: number | null;
  currency: string;
  customer_email: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
  customer_details?: {
    email?: string | null;
    name?: string | null;
  } | null;
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
  latest_charge: string | StripeChargeExpanded | null;
}

interface StripeChargeExpanded {
  id: string;
  balance_transaction: string | StripeBalanceTransaction | null;
  payment_method_details?: { type: string } | null;
}

interface StripeCharge {
  id: string;
  balance_transaction: string | null;
  payment_method_details?: { type: string } | null;
}

interface StripeDonorIdentity {
  name: string | null;
  email: string | null;
  organization: string | null;
  source: string | null;
}

interface DonorRow {
  name: string;
  email: string;
  organization: string | null;
  currency: string;
  gross_amount: number;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function getDonorIdentityFromSession(session: StripeCheckoutSession): StripeDonorIdentity {
  return {
    name: firstNonEmpty(session.metadata?.donor_name, session.customer_details?.name),
    email: firstNonEmpty(session.metadata?.donor_email, session.customer_email, session.customer_details?.email),
    organization: firstNonEmpty(session.metadata?.donor_organization),
    source: firstNonEmpty(session.metadata?.source),
  };
}

function isStripePaymentConfirmed(session: StripeCheckoutSession, eventType: string): boolean {
  if (eventType !== "checkout.session.completed" && eventType !== "checkout.session.async_payment_succeeded") {
    return false;
  }

  return session.payment_status === "paid";
}

async function loadCompletedDonor(db: Env["DB"], sessionId: string): Promise<DonorRow | null> {
  return db.prepare(
    `SELECT name, email, organization, currency, gross_amount
     FROM donations
     WHERE checkout_session_id = ?
       AND status = 'completed'
       AND completed_at IS NOT NULL
     LIMIT 1`,
  )
    .bind(sessionId)
    .first<DonorRow>();
}

export async function onRequestPost(c: any): Promise<Response> {
  const env: Env = c.env;
  const request = c.req.raw;

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

  if (event.type === "checkout.session.async_payment_failed") {
    const failedSession = event.data.object as StripeCheckoutSession;
    await env.DB.prepare(
      `UPDATE donations SET status = 'failed' WHERE checkout_session_id = ? AND status NOT IN ('completed')`,
    )
      .bind(failedSession.id)
      .run();

    interface FailedDonorRow {
      name: string;
      email: string;
      currency: string;
      gross_amount: number;
    }
    const failedDonor = await env.DB.prepare(
      `SELECT name, email, currency, gross_amount FROM donations WHERE checkout_session_id = ?`,
    )
      .bind(failedSession.id)
      .first<FailedDonorRow>();

    if (failedDonor?.email) {
      try {
        const firstName = failedDonor.name !== "Unknown" ? (failedDonor.name.split(" ")[0] ?? "") : "";
        const formattedAmount = formatMajorAmount(failedDonor.gross_amount, failedDonor.currency);
        const outboxId = await queueEmail(env.DB, {
          templateKey: "donation_payment_failed",
          recipientEmail: failedDonor.email,
          messageType: "transactional",
          subject: "Your donation payment failed — PKI Consortium",
          data: {
            firstName,
            name: failedDonor.name,
            formattedAmount,
            currency: failedDonor.currency.toUpperCase(),
          },
        });
        c.executionCtx.waitUntil(processOutboxByIdBackground(env.DB, env, outboxId));
      } catch (err) {
        console.error("Failed to queue donation payment failed email", err);
      }
    }

    return json({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    const expiredSession = event.data.object as StripeCheckoutSession;
    await env.DB.prepare(
      `UPDATE donations SET status = 'expired' WHERE checkout_session_id = ? AND status = 'pending'`,
    )
      .bind(expiredSession.id)
      .run();

    // Send a "your checkout expired" email with a retry link
    interface ExpiredDonorRow {
      name: string;
      email: string;
      currency: string;
      gross_amount: number;
      source: string | null;
    }
    const expiredDonor = await env.DB.prepare(
      `SELECT name, email, currency, gross_amount, source
       FROM donations WHERE checkout_session_id = ?`,
    )
      .bind(expiredSession.id)
      .first<ExpiredDonorRow>();

    if (expiredDonor?.email) {
      try {
        const firstName = expiredDonor.name !== "Unknown" ? (expiredDonor.name.split(" ")[0] ?? "") : "";
        const formattedAmount = formatMajorAmount(expiredDonor.gross_amount, expiredDonor.currency);
        const outboxId = await queueEmail(env.DB, {
          templateKey: "donation_expired",
          recipientEmail: expiredDonor.email,
          messageType: "transactional",
          subject: "Your donation checkout expired — PKI Consortium",
          data: {
            firstName,
            name: expiredDonor.name,
            formattedAmount,
            currency: expiredDonor.currency.toUpperCase(),
          },
        });
        c.executionCtx.waitUntil(processOutboxByIdBackground(env.DB, env, outboxId));
      } catch (err) {
        console.error("Failed to queue donation expired email", err);
      }
    }

    return json({ received: true });
  }

  // Only send donor follow-up after Stripe reports the session as paid.
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    // Acknowledge other events without processing them
    return json({ received: true });
  }

  const session = event.data.object as StripeCheckoutSession;
  if (!isStripePaymentConfirmed(session, event.type)) {
    // Async payment method (bank transfer / ACH / SEPA): checkout session
    // completed but settlement is still pending. Mark the donation so the
    // front-end can show a proper "waiting for bank" message instead of the
    // generic spinner timeout fallback.
    if (event.type === "checkout.session.completed" && session.payment_status === "unpaid") {
      const methodType = session.payment_method_types?.[0] ?? null;
      await env.DB.prepare(
        `UPDATE donations
         SET status = 'awaiting_payment',
             payment_method_type  = COALESCE(payment_method_type, ?),
             session_expires_at   = COALESCE(session_expires_at, ?)
         WHERE checkout_session_id = ? AND status = 'pending'`,
      )
        .bind(methodType, session.expires_at ?? null, session.id)
        .run();
    }
    return json({ received: true, pending: true });
  }
  const donorIdentity = getDonorIdentityFromSession(session);

  // ── Fetch net amount + actual payment method from Stripe ─────────────────
  // Gross amount is stored at checkout time. We traverse PI → charge →
  // balance_transaction to get the net (gross minus Stripe fee), and read
  // payment_method_details.type for the actual method used (not just what
  // was offered in the session).
  let netAmount: number | null = null;
  let paymentMethodType: string | null = null;
  let settledAmount: number | null = null;
  let settledCurrency: string | null = null;
  if (env.STRIPE_SECRET_KEY && session.payment_intent) {
    try {
      const details = await fetchPaymentDetails(env.STRIPE_SECRET_KEY, session.payment_intent);
      netAmount = details.netAmount;
      paymentMethodType = details.paymentMethodType;
      settledAmount = details.settledAmount;
      settledCurrency = details.settledCurrency;
    } catch (err) {
      // Non-fatal — we record null and can back-fill from admin sync
      console.error("Failed to fetch payment details for PI", session.payment_intent, err);
    }
  }

  // ── Update donation record ───────────────────────────────────────────────
  const completedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE donations
     SET payment_intent_id = ?,
         net_amount        = ?,
         completed_at      = ?,
         status            = 'completed',
         payment_method_type = COALESCE(payment_method_type, ?),
         settled_amount    = ?,
         settled_currency  = ?,
         name              = CASE
                               WHEN ? IS NOT NULL AND (name IS NULL OR TRIM(name) = '' OR name = 'Unknown')
                               THEN ?
                               ELSE name
                             END,
         email             = CASE
                               WHEN ? IS NOT NULL AND (email IS NULL OR TRIM(email) = '')
                               THEN ?
                               ELSE email
                             END,
         organization      = CASE
                               WHEN ? IS NOT NULL AND (organization IS NULL OR TRIM(organization) = '')
                               THEN ?
                               ELSE organization
                             END,
         source            = CASE
                               WHEN ? IS NOT NULL AND (source IS NULL OR TRIM(source) = '')
                               THEN ?
                               ELSE source
                             END
     WHERE checkout_session_id = ?`,
  )
    .bind(
      session.payment_intent ?? null,
      netAmount,
      completedAt,
      paymentMethodType,
      settledAmount,
      settledCurrency,
      donorIdentity.name,
      donorIdentity.name,
      donorIdentity.email,
      donorIdentity.email,
      donorIdentity.organization,
      donorIdentity.organization,
      donorIdentity.source,
      donorIdentity.source,
      session.id,
    )
    .run();

  let donor: DonorRow | null = null;
  if (result.meta?.changes !== 0) {
    donor = await loadCompletedDonor(env.DB, session.id);
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
          name, email, currency, gross_amount, net_amount, completed_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
    )
      .bind(
        donationId,
        session.id,
        session.payment_intent ?? null,
        donorIdentity.name ?? "Unknown",
        donorIdentity.email,
        fallbackCurrency,
        fallbackGross,
        netAmount,
        completedAt,
      )
      .run();
  }

  donor = donor ?? await loadCompletedDonor(env.DB, session.id);

  // ── Send thank-you email ─────────────────────────────────────────────────
  if (donor?.email) {
      try {
        const formattedAmount = formatMajorAmount(donor.gross_amount, donor.currency);
        const firstName = donor.name !== "Unknown" ? (donor.name.split(" ")[0] ?? "") : "";
        const bcc = env.DONATION_NOTIFICATION_EMAIL ? [env.DONATION_NOTIFICATION_EMAIL] : [];
        const origin = resolveAppBaseUrl(env, c.req.raw);

        // Pre-render the donation badge to R2 so the outbox can attach it
        await prerenderDonationBadge(session.id, env, origin);

        // Create the personalised share link so we can include it in the email
        const promoter = await getOrCreatePromoterCode(env.DB, session.id, origin);

      const outboxId = await queueEmail(env.DB, {
        templateKey: "donation_thank_you",
        recipientEmail: donor.email,
        messageType: "transactional",
        subject: "Thank you for your donation to the PKI Consortium",
        attachments: [
          buildBadgeAttachment({
            badgeCode: `donation-${session.id}`,
            badgeType: "donation",
            firstName,
            name: donor.name,
          }),
        ],
        data: {
          firstName,
          name: donor.name,
          email: donor.email,
          organizationName: donor.organization ?? "",
          currency: donor.currency.toUpperCase(),
          formattedAmount,
          donateUrl: "https://pkic.org/donate/",
          shareUrl: promoter?.shareUrl ?? "https://pkic.org/donate/",
          ...(bcc.length > 0 ? { __bccRecipients: bcc } : {}),
        },
      });
      c.executionCtx.waitUntil(processOutboxByIdBackground(env.DB, env, outboxId));
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
 * Fetches net amount and actual payment method type for a payment intent using
 * expand[] to get charge + balance_transaction in a single API call.
 */
async function fetchPaymentDetails(stripeKey: string, paymentIntentId: string): Promise<{ netAmount: number | null; paymentMethodType: string | null; settledAmount: number | null; settledCurrency: string | null }> {
  const headers = { "Authorization": `Bearer ${stripeKey}` };
  const url = `https://api.stripe.com/v1/payment_intents/${paymentIntentId}?expand[]=latest_charge.balance_transaction`;
  const piRes = await fetch(url, { headers });
  if (!piRes.ok) {
    console.error("fetchPaymentDetails: payment_intent fetch failed", piRes.status);
    return { netAmount: null, paymentMethodType: null, settledAmount: null, settledCurrency: null };
  }

  const pi = (await piRes.json()) as StripePaymentIntent;
  if (!pi.latest_charge || typeof pi.latest_charge === "string") {
    console.warn("fetchPaymentDetails: no expanded latest_charge on", paymentIntentId);
    return { netAmount: null, paymentMethodType: null, settledAmount: null, settledCurrency: null };
  }

  const charge = pi.latest_charge;
  const paymentMethodType = charge.payment_method_details?.type ?? null;

  if (!charge.balance_transaction || typeof charge.balance_transaction === "string") {
    console.warn("fetchPaymentDetails: no expanded balance_transaction on charge");
    return { netAmount: null, paymentMethodType, settledAmount: null, settledCurrency: null };
  }

  const bt = charge.balance_transaction;
  return { netAmount: bt.net ?? null, paymentMethodType, settledAmount: bt.amount ?? null, settledCurrency: bt.currency ?? null };
}

export class WebhooksStripePost extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    return onRequestPost(c as any);
  }
}
