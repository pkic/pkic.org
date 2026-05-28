/**
 * GET /api/v1/donations/session
 *
 * Returns minimal public information about a completed donation for badge
 * rendering on the thank-you page. The session_id query parameter is the
 * Stripe Checkout Session ID appended by Stripe as {CHECKOUT_SESSION_ID}.
 *
 * Only returns data for completed (paid) donations to prevent badge spoofing.
 * Deliberately omits donor email/name to avoid information leakage — only
 * data needed for the "I just donated X" badge is returned.
 */

import { OpenAPIRoute } from "chanfana";
import { donationSessionGetRouteSchema, donationSessionQuerySchema } from "../../../../assets/shared/schemas/donation";
import { json } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";
interface DonationBadgeRow {
  gross_amount: number;
  currency: string;
  name: string;
  source: string | null;
  completed_at: string | null;
  status: string;
  payment_method_type: string | null;
  session_expires_at: number | null;
}

export async function onRequestGet(c: any): Promise<Response> {
  const env: Env = c.env;
  const request = c.req.raw;

  const url = new URL(request.url);
  const query = donationSessionQuerySchema.safeParse({ session_id: url.searchParams.get("session_id") });
  if (!query.success) {
    return json({ error: "Invalid session_id" }, 400);
  }
  const sessionId = query.data.session_id;

  const row = await env.DB.prepare(
    `SELECT gross_amount, currency, name, source, completed_at, status, payment_method_type, session_expires_at
     FROM donations
     WHERE checkout_session_id = ?`,
  )
    .bind(sessionId)
    .first<DonationBadgeRow>();

  if (!row) {
    // Either not found or not yet created (race condition at checkout)
    return json({ pending: true }, 202);
  }

  if (row.status === "awaiting_payment") {
    // Async payment method (bank transfer / ACH / SEPA) initiated:
    // checkout completed but settlement takes 1–5 business days.
    return json(
      {
        pending: true,
        asyncPayment: true,
        paymentMethodType: row.payment_method_type,
        sessionExpiresAt: row.session_expires_at,
      },
      202,
    );
  }

  if (row.status === "failed") {
    return json({ failed: true }, 200);
  }

  if (row.status === "expired") {
    return json({ expired: true }, 200);
  }

  if (!row.completed_at) {
    // Still pending (webhook not yet received)
    return json({ pending: true }, 202);
  }

  return json({
    grossAmount: row.gross_amount,
    currency: row.currency,
    donorFirstName: row.name.split(" ")[0] ?? null,
    source: row.source,
    completedAt: row.completed_at,
  });
}

export class DonationsSessionGet extends OpenAPIRoute {
  schema = donationSessionGetRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
