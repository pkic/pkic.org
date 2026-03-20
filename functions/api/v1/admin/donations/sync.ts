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
import { queueEmail, processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import type { PagesContext } from "../../../../_lib/types";

interface PendingDonation {
  id: string;
  checkout_session_id: string;
}

interface StripeSession {
  id: string;
  status: "open" | "complete" | "expired";
  payment_status: string;
  payment_intent: string | null;
  amount_total: number | null;
  currency: string;
  customer_email: string | null;
}

interface StripePaymentIntent {
  id: string;
  latest_charge: string | null;
}

interface StripeCharge {
  id: string;
  balance_transaction: string | null;
}

interface StripeBalanceTransaction {
  id: string;
  net: number;
}

interface SyncResult {
  sessionId: string;
  outcome: "completed" | "expired" | "still_pending" | "error";
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

async function fetchNetAmount(stripeKey: string, paymentIntentId: string): Promise<number | null> {
  const headers = { "Authorization": `Bearer ${stripeKey}` };
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

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const { env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: { code: "NOT_CONFIGURED", message: "STRIPE_SECRET_KEY is not configured" } }, 503);
  }

  // ── Determine which sessions to sync ─────────────────────────────────────
  let targetIds: string[] | null = null;
  const contentType = context.request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await context.request.json() as { sessionIds?: unknown };
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
    pending = await all<PendingDonation>(
      env.DB,
      `SELECT id, checkout_session_id FROM donations
       WHERE status = 'pending' AND checkout_session_id IN (${placeholders})`,
      targetIds,
    );
  } else {
    pending = await all<PendingDonation>(
      env.DB,
      `SELECT id, checkout_session_id FROM donations WHERE status = 'pending'`,
      [],
    );
  }

  if (pending.length === 0) {
    return json({ synced: 0, results: [] });
  }

  // ── Process each session sequentially to avoid hammering Stripe ──────────
  const results: SyncResult[] = [];

  for (const donation of pending) {
    const sessionId = donation.checkout_session_id;
    try {
      const session = await fetchStripeSession(env.STRIPE_SECRET_KEY, sessionId);
      if (!session) {
        results.push({ sessionId, outcome: "error", error: "Failed to fetch session from Stripe" });
        continue;
      }

      if (session.status === "complete") {
        const completedAt = new Date().toISOString();
        let netAmount: number | null = null;
        if (session.payment_intent) {
          try {
            netAmount = await fetchNetAmount(env.STRIPE_SECRET_KEY, session.payment_intent);
          } catch {
            // non-fatal
          }
        }
        await env.DB.prepare(
          `UPDATE donations
           SET payment_intent_id = ?,
               net_amount        = ?,
               completed_at      = ?,
               status            = 'completed'
           WHERE checkout_session_id = ?`,
        )
          .bind(session.payment_intent ?? null, netAmount, completedAt, sessionId)
          .run();
        results.push({ sessionId, outcome: "completed" });

        // Send thank-you email (same as webhook would send)
        try {
          const donor = await env.DB.prepare(
            `SELECT name, email, organization, currency, gross_amount
             FROM donations WHERE checkout_session_id = ?`,
          ).bind(sessionId).first<DonorRow>();
          if (donor?.email) {
            const firstName = donor.name !== "Unknown" ? (donor.name.split(" ")[0] ?? "") : "";
            const formattedAmount = formatMajorAmount(donor.gross_amount, donor.currency);
            const bcc = env.DONATION_NOTIFICATION_EMAIL ? [env.DONATION_NOTIFICATION_EMAIL] : [];
            const outboxId = await queueEmail(env.DB, {
              templateKey: "donation_thank_you",
              recipientEmail: donor.email,
              messageType: "transactional",
              subject: "Thank you for your donation to the PKI Consortium",
              data: {
                firstName,
                name: donor.name,
                email: donor.email,
                organizationName: donor.organization ?? "",
                currency: donor.currency.toUpperCase(),
                formattedAmount,
                donateUrl: "https://pkic.org/donate/",
                ...(bcc.length > 0 ? { __bccRecipients: bcc } : {}),
              },
            });
            context.waitUntil(processOutboxByIdBackground(env.DB, env, outboxId));
          }
        } catch (err) {
          console.error("Failed to queue donation thank-you email during sync", err);
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
          ).bind(sessionId).first<DonorRow>();
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
            context.waitUntil(processOutboxByIdBackground(env.DB, env, outboxId));
          }
        } catch (err) {
          console.error("Failed to queue donation expired email during sync", err);
        }

      } else {
        // still "open" — payment not yet made
        results.push({ sessionId, outcome: "still_pending" });
      }
    } catch (err) {
      results.push({ sessionId, outcome: "error", error: (err as Error).message });
    }
  }

  const completed = results.filter((r) => r.outcome === "completed").length;
  const expired   = results.filter((r) => r.outcome === "expired").length;
  const errors    = results.filter((r) => r.outcome === "error").length;

  return json({ synced: pending.length, completed, expired, errors, results });
}
