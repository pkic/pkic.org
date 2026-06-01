/**
 * POST /api/v1/donations/promoter
 *
 * Creates (or returns an existing) personalised share link for a completed
 * donation.  The link is used on the thank-you page so the donor can share a
 * URL that includes their OG badge image as the social-card preview and drives
 * traffic back to /donate/.
 *
 * Request body: { session_id: "cs_live_..." }
 *
 * Response:
 *   { code: string; shareUrl: string; ogImageUrl: string }
 *
 * Rate note: this is unauthenticated but requires a valid, *completed*
 * checkout session ID. An attacker who guesses a session ID gains only a
 * vanity share link — no PII is exposed.
 */

import { OpenAPIRoute } from "chanfana";
import {
  donationPromoterPostRouteSchema,
  donationPromoterRequestSchema,
} from "../../../../assets/shared/schemas/donation";
import { json } from "../../../_lib/http";
import { parseJsonBody } from "../../../_lib/validation";
import { isAppError } from "../../../_lib/errors";
import { first, run } from "../../../_lib/db/queries";
import { randomBase62 } from "../../../_lib/utils/ids";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { nowIso } from "../../../_lib/utils/time";
import type { DatabaseLike } from "../../../_lib/types";
interface DonationRow {
  id: string;
  name: string;
  checkout_session_id: string;
}

interface ExistingPromoter {
  code: string;
}

export async function onRequestPost(c: any): Promise<Response> {
  const env = c.env;
  const request = c.req.raw;
  const db = env.DB;

  let body: { session_id: string };
  try {
    body = await parseJsonBody(request, donationPromoterRequestSchema);
  } catch (error) {
    if (isAppError(error) && (error.code === "INVALID_JSON" || error.code === "VALIDATION_ERROR")) {
      return json({ error: { code: "BAD_REQUEST", message: error.message } }, 400);
    }
    throw error;
  }
  const sessionId = body.session_id;

  // Must be a completed donation
  const donation = await first<DonationRow>(
    db,
    `SELECT id, name, checkout_session_id
     FROM donations
     WHERE checkout_session_id = ?
       AND status = 'completed'`,
    [sessionId],
  );
  if (!donation) {
    return json({ error: { code: "NOT_FOUND", message: "Completed donation not found for this session" } }, 404);
  }

  // Return existing code if already created for this donation
  const existing = await first<ExistingPromoter>(
    db,
    "SELECT code FROM donation_promoters WHERE donation_id = ? LIMIT 1",
    [donation.id],
  );
  if (existing) {
    return respondWithCode(existing.code, sessionId, resolveAppBaseUrl(env, request));
  }

  // Generate a new unique code
  const firstName = donation.name.split(" ")[0] ?? null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomBase62(8);
    const clash = await first<{ code: string }>(db, "SELECT code FROM donation_promoters WHERE code = ?", [code]);
    if (clash) continue;

    await run(
      db,
      `INSERT INTO donation_promoters (code, donation_id, checkout_session_id, name, clicks, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [code, donation.id, sessionId, firstName, nowIso()],
    );

    return respondWithCode(code, sessionId, resolveAppBaseUrl(env, request));
  }

  return json({ error: { code: "INTERNAL_ERROR", message: "Unable to generate unique share code" } }, 500);
}

function respondWithCode(code: string, sessionId: string, appBaseUrl: string): Response {
  return json({
    code,
    shareUrl: `${appBaseUrl}/donate/r/${encodeURIComponent(code)}`,
    ogImageUrl: `${appBaseUrl}/api/v1/og/donation/${encodeURIComponent(sessionId)}`,
  });
}

/**
 * Server-side helper: creates (or returns an existing) promoter code for a
 * completed donation. Safe to call from the Stripe webhook and admin sync.
 * Returns null if the donation is not found or not yet completed.
 */
export async function getOrCreatePromoterCode(
  db: DatabaseLike,
  sessionId: string,
  appBaseUrl: string,
): Promise<{ code: string; shareUrl: string } | null> {
  const donation = await first<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM donations WHERE checkout_session_id = ? AND status = 'completed'`,
    [sessionId],
  );
  if (!donation) return null;

  const existing = await first<{ code: string }>(
    db,
    "SELECT code FROM donation_promoters WHERE donation_id = ? LIMIT 1",
    [donation.id],
  );
  if (existing) {
    return { code: existing.code, shareUrl: `${appBaseUrl}/donate/r/${encodeURIComponent(existing.code)}` };
  }

  const firstName = donation.name.split(" ")[0] ?? null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomBase62(8);
    const clash = await first<{ code: string }>(db, "SELECT code FROM donation_promoters WHERE code = ?", [code]);
    if (clash) continue;
    await run(
      db,
      `INSERT INTO donation_promoters (code, donation_id, checkout_session_id, name, clicks, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [code, donation.id, sessionId, firstName, nowIso()],
    );
    return { code, shareUrl: `${appBaseUrl}/donate/r/${encodeURIComponent(code)}` };
  }
  return null;
}

export class DonationsPromoterPost extends OpenAPIRoute {
  schema = donationPromoterPostRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
