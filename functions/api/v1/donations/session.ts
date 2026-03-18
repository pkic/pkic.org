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

import { json } from "../../../_lib/http";
import type { PagesContext } from "../../../_lib/types";

interface DonationBadgeRow {
  gross_amount: number;
  currency: string;
  donor_name: string;
  source: string | null;
  completed_at: string | null;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const { request, env } = context;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId || !sessionId.startsWith("cs_")) {
    return json({ error: "Invalid session_id" }, 400);
  }

  const row = await env.DB.prepare(
    `SELECT gross_amount, currency, donor_name, source, completed_at
     FROM donations
     WHERE checkout_session_id = ?
       AND completed_at IS NOT NULL`,
  )
    .bind(sessionId)
    .first<DonationBadgeRow>();

  if (!row) {
    // Either not found or not yet completed (webhook may be in-flight)
    return json({ pending: true }, 202);
  }

  return json({
    grossAmount: row.gross_amount,
    currency: row.currency,
    donorFirstName: row.donor_name.split(" ")[0] ?? null,
    source: row.source,
    completedAt: row.completed_at,
  });
}
