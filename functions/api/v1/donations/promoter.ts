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

import {
  donationPromoterPostRouteSchema,
  donationPromoterRequestSchema,
} from "../../../../assets/shared/schemas/donation";
import { json } from "../../../_lib/http";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { getOrCreateDonationPromoter } from "../../../_lib/services/donations/promoter";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { z } from "zod";

type DonationPromoterRequest = z.infer<typeof donationPromoterRequestSchema>;

async function handleDonationPromoter(c: any, body: DonationPromoterRequest): Promise<Response> {
  const env = c.env;
  const request = c.req.raw;
  const db = env.DB;

  const sessionId = body.session_id;

  const promoter = await getOrCreateDonationPromoter(db, sessionId, resolveAppBaseUrl(env, request));
  if (!promoter) {
    return json({ error: { code: "NOT_FOUND", message: "Completed donation not found for this session" } }, 404);
  }
  return json(promoter);
}

export const DonationsPromoterPost = openApiRoute(donationPromoterPostRouteSchema, (c: any, data) =>
  handleDonationPromoter(c, data.body),
);
