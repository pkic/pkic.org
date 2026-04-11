/**
 * POST /api/v1/admin/donations/sync
 *
 * Polls Stripe for every pending donation (status = 'pending') and updates the
 * database with the current session state. Useful when the webhook was not yet
 * configured or missed events due to downtime.
 *
 * Body (optional JSON):
 *   { sessionIds?: string[] }   — sync only the listed checkout_session_ids;
 *                                  omit to sync all pending donations.
 *
 * For each pending session this queries:
 *   GET https://api.stripe.com/v1/checkout/sessions/{id}
 *
 * Outcomes:
 *   session.status === 'complete'  → set completed_at, payment_intent_id,
 *                                    net_amount, status = 'completed'
 *   session.status === 'expired'   → set status = 'expired'
 *   session.status === 'open'      → leave as pending (still in progress)
 *
 * Requires: STRIPE_SECRET_KEY env secret.
 */

import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { all } from "../../../../_lib/db/queries";
import { buildBadgeAttachment } from "../../../../_lib/email/attachments";
import { queueEmail, processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { prerenderDonationBadge } from "../../../../_lib/services/og-badge-prerender";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { getOrCreatePromoterCode } from "../../donations/promoter";

interface PendingDonation {
  id: string;
  checkout_session_id: string;
}

interface StripeSession {
  id: string;
  status: "open" | "complete" | "expired";
  payment_status: string;
  payment_intent: string | null;
  payment_method_types?: string[] | null;
  expires_at?: number | null;
  amount_total: number | null;
  currency: string;
  customer_email: string | null;
}

interface StripePaymentIntent {
  id: string;
  status: string;
  latest_charge: string | null;
  /** Non-null when the PI was declined (e.g. redirect-based methods like iDEAL that never create a charge). */
  last_payment_error: { code: string; type: string } | null;
  /** The actual method type is also available at PI level for redirect-based methods. */
  payment_method_types?: string[] | null;
}

interface StripeCharge {
  id: string;
  balance_transaction: string | null;
  failure_code: string | null;
  payment_method_details?: { type: string } | null;
}

interface StripeBalanceTransaction {
  id: string;
  net: number;
}

interface SyncResult {
  sessionId: string;
  outcome: "completed" | "expired" | "awaiting_payment" | "failed" | "still_pending" | "error";
  error?: string;
}

interface DonorRow {
  name: string;
  email: string;
  organization: string | null;
  currency: string;
  gross_amount: number;
}

function formatMajorAmount(smallestUnit: number, currencyCode: string): string {
  const zeroDecimal = new Set(["bif","clp","gnf","jpy","kmf","krw","mga","pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"]);
  const isZeroDecimal = zeroDecimal.has(currencyCode.toLowerCase());
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

async function fetchStripeSession(stripeKey: string, sessionId: string): Promise<StripeSession | null> {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { "Authorization": `Bearer ${stripeKey}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as StripeSession;
}

interface PaymentDetails {
  netAmount: number | null;
  paymentMethodType: string | null;
  /** True when the charge has a failure_code — payment was attempted and rejected. */
  paymentFailed: boolean;
}

async function fetchPaymentDetails(stripeKey: string, paymentIntentId: string): Promise<PaymentDetails> {
  const headers = { "Authorization": `Bearer ${stripeKey}` };
  const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, { headers });
  // ── Propagate early returns from fetchPaymentDetails when no latest_charge
  // (means payment was never attempted — keep existing null returns)
  if (!piRes.ok) {
    console.error("fetchPaymentDetails: payment_intent fetch failed", piRes.status, await piRes.text());
    return { netAmount: null, paymentMethodType: null, paymentFailed: false };
  }
  const pi = (await piRes.json()) as StripePaymentIntent;

  // Redirect-based async methods (iDEAL, Bancontact, etc.) may fail WITHOUT
  // creating a charge — the PI status returns to requires_payment_method with
  // last_payment_error set instead.
  if (!pi.latest_charge) {
    // Only return a method type when the user has committed to one:
    //   requires_action  = bank redirect initiated (e.g. iDEAL mid-flow)
    //   processing       = being processed by the acquiring bank
    // For plain requires_payment_method (no attempt yet), we don't know the method.
    const committedMethod = (pi.status === "requires_action" || pi.status === "processing")
      ? (pi.payment_method_types?.[0] ?? null)
      : null;
    if (pi.status === "requires_payment_method" && pi.last_payment_error) {
      return { netAmount: null, paymentMethodType: committedMethod ?? pi.payment_method_types?.[0] ?? null, paymentFailed: true };
    }
    console.warn("fetchPaymentDetails: no latest_charge on", paymentIntentId, "pi.status:", pi.status);
    return { netAmount: null, paymentMethodType: committedMethod, paymentFailed: false };
  }
  const chargeRes = await fetch(`https://api.stripe.com/v1/charges/${pi.latest_charge}`, { headers });
  if (!chargeRes.ok) {
    console.error("fetchPaymentDetails: charge fetch failed", chargeRes.status);
    return { netAmount: null, paymentMethodType: null, paymentFailed: false };
  }
  const charge = (await chargeRes.json()) as StripeCharge;
  const paymentMethodType = charge.payment_method_details?.type ?? null;

  // A non-null failure_code means the charge was attempted and declined/bounced.
  if (charge.failure_code) {
    return { netAmount: null, paymentMethodType, paymentFailed: true };
  }

  if (!charge.balance_transaction) {
    console.warn("fetchPaymentDetails: no balance_transaction on charge");
    return { netAmount: null, paymentMethodType, paymentFailed: false };
  }
  const btRes = await fetch(`https://api.stripe.com/v1/balance_transactions/${charge.balance_transaction}`, { headers });
  if (!btRes.ok) {
    console.error("fetchPaymentDetails: balance_transaction fetch failed", btRes.status);
    return { netAmount: null, paymentMethodType, paymentFailed: false };
  }
  const bt = (await btRes.json()) as StripeBalanceTransaction;
  return { netAmount: bt.net ?? null, paymentMethodType, paymentFailed: false };
}

async function sendPaymentFailedEmail(db: D1Database, env: any, sessionId: string, executionCtx: ExecutionContext): Promise<void> {
  try {
    const donor = await db.prepare(
      `SELECT name, email, currency, gross_amount FROM donations WHERE checkout_session_id = ?`,
    ).bind(sessionId).first() as DonorRow | null;
    if (!donor?.email) return;
    const firstName = donor.name !== "Unknown" ? (donor.name.split(" ")[0] ?? "") : "";
    const formattedAmount = formatMajorAmount(donor.gross_amount, donor.currency);
    const outboxId = await queueEmail(db, {
      templateKey: "donation_payment_failed",
      recipientEmail: donor.email,
      messageType: "transactional",
      subject: "Your donation payment failed — PKI Consortium",
      data: {
        firstName,
        name: donor.name,
        formattedAmount,
        currency: donor.currency.toUpperCase(),
      },
    });
    executionCtx.waitUntil(processOutboxByIdBackground(db, env, outboxId));
  } catch (err) {
    console.error("Failed to queue donation payment failed email during sync", err);
  }
}

export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);

  const { env } = c;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: { code: "NOT_CONFIGURED", message: "STRIPE_SECRET_KEY is not configured" } }, 503);
  }

  // ── Determine which sessions to sync ─────────────────────────────────────
  let targetIds: string[] | null = null;
  const contentType = c.req.raw.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await c.req.raw.json() as { sessionIds?: unknown };
      if (Array.isArray(body.sessionIds) && body.sessionIds.every((s) => typeof s === "string")) {
        targetIds = body.sessionIds as string[];
      }
    } catch {
      // ignore — treat as "sync all"
    }
  }

  let pending: PendingDonation[];
  if (targetIds && targetIds.length > 0) {
    const placeholders = targetIds.map(() => "?").join(", ");
    // When explicit IDs are requested, also include completed rows that are
    // missing net_amount or payment_method_type so admins can backfill them.
    pending = await all<PendingDonation>(
      env.DB,
      `SELECT id, checkout_session_id FROM donations
       WHERE checkout_session_id IN (${placeholders})
         AND (status IN ('pending', 'awaiting_payment')
              OR (status = 'completed' AND (net_amount IS NULL OR payment_method_type IS NULL)))`,
      targetIds,
    );
  } else {
    // Also include completed rows missing net_amount or payment_method_type so a
    // single "Sync all" backfills historical data without per-row clicks.
    pending = await all<PendingDonation>(
      env.DB,
      `SELECT id, checkout_session_id FROM donations
       WHERE status IN ('pending', 'awaiting_payment')
          OR (status = 'completed' AND (net_amount IS NULL OR payment_method_type IS NULL))`,
      [],
    );
  }

  if (pending.length === 0) {
    return json({ synced: 0, results: [] });
  }

  interface PendingDonationWithStatus extends PendingDonation {
    status: string;
  }
  const pendingWithStatus = await all<PendingDonationWithStatus>(
    env.DB,
    `SELECT id, checkout_session_id, status FROM donations WHERE id IN (${pending.map(() => "?").join(", ")})`,
    pending.map((p) => p.id),
  );
  const statusById = Object.fromEntries(pendingWithStatus.map((p) => [p.checkout_session_id, p.status]));

  // ── Process each session sequentially to avoid hammering Stripe ──────────
  const results: SyncResult[] = [];

  for (const donation of pending) {
    const sessionId = donation.checkout_session_id;
    const currentStatus = statusById[sessionId] ?? "pending";
    try {
      const session = await fetchStripeSession(env.STRIPE_SECRET_KEY, sessionId);
      if (!session) {
        results.push({ sessionId, outcome: "error", error: "Failed to fetch session from Stripe" });
        continue;
      }

      // ── Already-completed row: backfill net_amount / payment_method_type only
      if (currentStatus === "completed") {
        let details: PaymentDetails = { netAmount: null, paymentMethodType: null, paymentFailed: false };
        if (session.payment_intent) {
          details = await fetchPaymentDetails(env.STRIPE_SECRET_KEY, session.payment_intent);
        }
        await env.DB.prepare(
          `UPDATE donations
           SET net_amount           = COALESCE(net_amount, ?),
               payment_method_type  = COALESCE(payment_method_type, ?),
               payment_intent_id    = COALESCE(payment_intent_id, ?)
           WHERE checkout_session_id = ?`,
        )
          .bind(details.netAmount, details.paymentMethodType, session.payment_intent ?? null, sessionId)
          .run();
        results.push({ sessionId, outcome: "completed" });
        continue;
      }

      if (session.status === "complete" && session.payment_status === "paid") {
        const completedAt = new Date().toISOString();
        let details: PaymentDetails = { netAmount: null, paymentMethodType: null, paymentFailed: false };
        if (session.payment_intent) {
          details = await fetchPaymentDetails(env.STRIPE_SECRET_KEY, session.payment_intent);
        }
        await env.DB.prepare(
          `UPDATE donations
           SET payment_intent_id = ?,
               net_amount        = ?,
               completed_at      = ?,
               status            = 'completed',
               payment_method_type = COALESCE(payment_method_type, ?)
           WHERE checkout_session_id = ?`,
        )
          .bind(session.payment_intent ?? null, details.netAmount, completedAt, details.paymentMethodType, sessionId)
          .run();
        results.push({ sessionId, outcome: "completed" });

        // Send thank-you email (same as webhook would send)
        try {
          const donor = await env.DB.prepare(
            `SELECT name, email, organization, currency, gross_amount
             FROM donations WHERE checkout_session_id = ?`,
          ).bind(sessionId).first() as DonorRow | null;
          if (donor?.email) {
            const firstName = donor.name !== "Unknown" ? (donor.name.split(" ")[0] ?? "") : "";
            const formattedAmount = formatMajorAmount(donor.gross_amount, donor.currency);
            const bcc = env.DONATION_NOTIFICATION_EMAIL ? [env.DONATION_NOTIFICATION_EMAIL] : [];
            const origin = resolveAppBaseUrl(env, c.req.raw);

            // Pre-render the donation badge to R2 so the outbox can attach it
            await prerenderDonationBadge(sessionId, env, origin);

            // Create the personalised share link so we can include it in the email
            const promoter = await getOrCreatePromoterCode(env.DB, sessionId, origin);

            const outboxId = await queueEmail(env.DB, {
              templateKey: "donation_thank_you",
              recipientEmail: donor.email,
              messageType: "transactional",
              subject: "Thank you for your donation to the PKI Consortium",
              attachments: [
                buildBadgeAttachment({
                  badgeCode: `donation-${sessionId}`,
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
          }
        } catch (err) {
          console.error("Failed to queue donation thank-you email during sync", err);
        }

      } else if (session.status === "complete" && session.payment_status !== "paid") {
        // Checkout completed but bank transfer / ACH / SEPA not yet settled.
        // First check whether the payment actually failed (e.g. SEPA bounce, bank rejection).
        let details: PaymentDetails = { netAmount: null, paymentMethodType: session.payment_method_types?.[0] ?? null, paymentFailed: false };
        if (session.payment_intent) {
          details = await fetchPaymentDetails(env.STRIPE_SECRET_KEY, session.payment_intent);
        }

        if (details.paymentFailed) {
          await env.DB.prepare(
            `UPDATE donations
             SET status = 'failed',
                 payment_method_type = COALESCE(payment_method_type, ?)
             WHERE checkout_session_id = ? AND status NOT IN ('completed')`,
          )
            .bind(details.paymentMethodType, sessionId)
            .run();
          await sendPaymentFailedEmail(env.DB, env, sessionId, c.executionCtx);
          results.push({ sessionId, outcome: "failed" });
        } else {
          // Still in flight — mark as awaiting_payment so the front-end shows the correct message;
          // the async_payment_succeeded webhook will complete it when the bank confirms.
          const methodType = details.paymentMethodType ?? session.payment_method_types?.[0] ?? null;
          await env.DB.prepare(
            `UPDATE donations
             SET status = 'awaiting_payment',
                 payment_method_type  = COALESCE(payment_method_type, ?),
                 session_expires_at   = COALESCE(session_expires_at, ?)
             WHERE checkout_session_id = ? AND status = 'pending'`,
          )
            .bind(methodType, session.expires_at ?? null, sessionId)
            .run();
          results.push({ sessionId, outcome: "awaiting_payment" });
        }

      } else if (session.status === "expired") {
        await env.DB.prepare(
          `UPDATE donations SET status = 'expired' WHERE checkout_session_id = ?`,
        )
          .bind(sessionId)
          .run();
        results.push({ sessionId, outcome: "expired" });

        // Send expired email (same as webhook would send)
        try {
          const donor = await env.DB.prepare(
            `SELECT name, email, currency, gross_amount
             FROM donations WHERE checkout_session_id = ?`,
          ).bind(sessionId).first() as DonorRow | null;
          if (donor?.email) {
            const firstName = donor.name !== "Unknown" ? (donor.name.split(" ")[0] ?? "") : "";
            const formattedAmount = formatMajorAmount(donor.gross_amount, donor.currency);
            const outboxId = await queueEmail(env.DB, {
              templateKey: "donation_expired",
              recipientEmail: donor.email,
              messageType: "transactional",
              subject: "Your donation checkout expired — PKI Consortium",
              data: {
                firstName,
                name: donor.name,
                formattedAmount,
                currency: donor.currency.toUpperCase(),
              },
            });
            c.executionCtx.waitUntil(processOutboxByIdBackground(env.DB, env, outboxId));
          }
        } catch (err) {
          console.error("Failed to queue donation expired email during sync", err);
        }

      } else {
        // "open" session — payment not yet made, or was declined (which keeps the session open for retry)
        let isFailed = false;
        if (session.payment_intent) {
          const details = await fetchPaymentDetails(env.STRIPE_SECRET_KEY, session.payment_intent);
          if (details.paymentFailed) {
            isFailed = true;
            await env.DB.prepare(
              `UPDATE donations
               SET status = 'failed',
                   payment_method_type = COALESCE(payment_method_type, ?)
               WHERE checkout_session_id = ? AND status NOT IN ('completed')`,
            )
              .bind(details.paymentMethodType, sessionId)
              .run();
            await sendPaymentFailedEmail(env.DB, env, sessionId, c.executionCtx);
            results.push({ sessionId, outcome: "failed" });
          } else if (details.paymentMethodType) {
            // User has committed to a method (e.g. iDEAL bank redirect initiated) — save it
            await env.DB.prepare(
              `UPDATE donations SET payment_method_type = COALESCE(payment_method_type, ?)
               WHERE checkout_session_id = ? AND status NOT IN ('completed')`,
            )
              .bind(details.paymentMethodType, sessionId)
              .run();
          }
        }
        if (!isFailed) {
          results.push({ sessionId, outcome: "still_pending" });
        }
      }
    } catch (err) {
      results.push({ sessionId, outcome: "error", error: (err as Error).message });
    }
  }

  const completed        = results.filter((r) => r.outcome === "completed").length;
  const awaitingPayment  = results.filter((r) => r.outcome === "awaiting_payment").length;
  const expired          = results.filter((r) => r.outcome === "expired").length;
  const failed           = results.filter((r) => r.outcome === "failed").length;
  const errors           = results.filter((r) => r.outcome === "error").length;

  return json({ synced: pending.length, completed, awaitingPayment, expired, failed, errors, results });
}
