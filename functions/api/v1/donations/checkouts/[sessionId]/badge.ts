/**
 * GET /api/v1/donations/checkouts/:sessionId/badge
 *
 * Returns a personalised 1200x630 donation badge for sharing on social
 * media. The badge shows the donor's name, the amount donated, and a
 * "Match this donation!" CTA, styled to match the PKI Consortium brand.
 *
 * Only returns a badge for completed (paid) donations — pending or missing
 * sessions receive 202 { pending: true } or 404.
 *
 * The JPEG is cached in R2 (ASSETS_BUCKET, key "og-badges/donation-{sessionId}")
 * on first render and served from cache on subsequent requests.
 */

import { json } from "../../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { readCachedBadge, serveGeneratedBadge } from "../../../../../_lib/services/og-badge-http";
import { generateDonationBadgePng } from "../../../../../_lib/services/og-badge-prerender";

const R2_KEY_PREFIX = "og-badges/donation-";

export async function onRequestGet(c: any): Promise<Response> {
  const sessionId = c.req.param("sessionId");
  const bucket = c.env.ASSETS_BUCKET;
  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  const url = new URL(c.req.raw.url);

  if (!sessionId || !sessionId.startsWith("cs_")) {
    return json({ error: "Invalid session_id" }, 400);
  }

  const isDownload = url.searchParams.get("download") === "1";
  const rawName = url.searchParams.get("name") ?? "donation-badge";

  const r2Key = `${R2_KEY_PREFIX}${sessionId}`;

  const responseOptions = {
    bucket,
    cacheKey: r2Key,
    cacheMetadata: { sessionId },
    isDownload,
    downloadName: rawName,
    fallbackDownloadName: "donation-badge",
  };
  const cached = await readCachedBadge(responseOptions);
  if (cached) return cached;

  // 2. Generate PNG
  let png: Uint8Array | null;
  try {
    png = await generateDonationBadgePng(sessionId, c.env, origin);
  } catch {
    return new Response("Badge rendering unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }

  if (!png) {
    // Not found or not yet completed — preserve the checkout-status 202 behavior.
    return json({ pending: true }, 202);
  }

  return serveGeneratedBadge(png, c.env.IMAGES, c.executionCtx, responseOptions);
}
