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

import { donationSessionGetRouteSchema, donationSessionQuerySchema } from "../../../../assets/shared/schemas/donation";
import { json } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";
import { openApiRoute } from "../../../_lib/openapi/route";
import { getDonationBadgeBySession } from "../../../_lib/services/donations";

export async function onRequestGet(c: any): Promise<Response> {
  const env: Env = c.env;
  const request = c.req.raw;

  const url = new URL(request.url);
  const query = donationSessionQuerySchema.safeParse({ session_id: url.searchParams.get("session_id") });
  if (!query.success) {
    return json({ error: "Invalid session_id" }, 400);
  }
  const sessionId = query.data.session_id;

  const row = await getDonationBadgeBySession(env.DB, sessionId);

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

// Kept as a thin openApiRoute wrap around the untouched onRequestGet — that
// function is imported directly by tests/donation-checkout.test.ts and
// tests/donation-session-promoter-webhook.test.ts (bypassing chanfana
// entirely), so its manual query-parsing/error-shape behavior can't change
// here. GET has no request body, so wrapping it doesn't risk the
// double-body-read hazard that rules out wrapping the POST endpoints in this
// directory (see donations/promoter.ts).
export const DonationsSessionGet = openApiRoute(donationSessionGetRouteSchema, (c: any) => onRequestGet(c));
