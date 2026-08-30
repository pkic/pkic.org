/**
 * Registration referral badge image endpoint
 * GET /api/v1/registrations/referrals/:code/badge
 *
 * Returns a personalised 1200x630 social-sharing badge for the person
 * associated with the given referral code. The production path serves JPEG;
 * local dev falls back to PNG when the Images binding is unavailable.
 *
 * The JPEG is cached in R2 (ASSETS_BUCKET, key "og-badges/{code}")
 * on first render and served from cache on subsequent requests.
 */

import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { readCachedBadge, serveGeneratedBadge } from "../../../../../_lib/services/og-badge-http";
import { generateBadgePng } from "../../../../../_lib/services/og-badge-prerender";

const R2_KEY_PREFIX = "og-badges/";

export async function onRequestGet(c: any): Promise<Response> {
  const code = c.req.param("code");
  const r2Key = `${R2_KEY_PREFIX}${code}`;
  const bucket = c.env.ASSETS_BUCKET;
  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  const url = new URL(c.req.raw.url);
  const isDownload = url.searchParams.get("download") === "1";
  const rawName = url.searchParams.get("name") ?? "";

  const responseOptions = {
    bucket,
    cacheKey: r2Key,
    cacheMetadata: { referralCode: code },
    isDownload,
    downloadName: rawName,
    fallbackDownloadName: "attendee-badge",
  };
  const cached = await readCachedBadge(responseOptions);
  if (cached) return cached;

  // 2. Generate PNG (wasm init + fonts + DB + render, all parallelised)
  let png: Uint8Array | null;
  try {
    png = await generateBadgePng(code, c.env, origin);
  } catch {
    return new Response("SVG rendering unavailable in this environment", {
      status: 503,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }

  if (!png) {
    return json({ error: { code: "NOT_FOUND", message: "Unknown referral code" } }, 404);
  }

  return serveGeneratedBadge(png, c.env.IMAGES, c.executionCtx, responseOptions);
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
