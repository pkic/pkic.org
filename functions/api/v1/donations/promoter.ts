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
import { resolveAppBaseUrl } from "../../../_lib/config";
import { getOrCreateDonationPromoter } from "../../../_lib/services/donations/promoter";

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

  const promoter = await getOrCreateDonationPromoter(db, sessionId, resolveAppBaseUrl(env, request));
  if (!promoter) {
    return json({ error: { code: "NOT_FOUND", message: "Completed donation not found for this session" } }, 404);
  }
  return json(promoter);
}

export class DonationsPromoterPost extends OpenAPIRoute {
  schema = donationPromoterPostRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
