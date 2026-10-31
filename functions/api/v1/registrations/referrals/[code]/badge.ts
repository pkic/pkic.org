import {
  personalPromotionImageQuerySchema,
  personalPromotionImageCacheKey,
} from "../../../../../../assets/shared/personal-promotion-image";
import { readBadgeSource, personalBadgeCacheMetadata } from "../../../../../_lib/services/og-badge-source";
/**
 * Registration referral badge image endpoint
 * GET /api/v1/registrations/referrals/:code/badge
 *
 * Returns a personalized 1200x630 landscape or 1080x1080 square social-sharing card for the person
 * associated with the given referral code. The production path serves JPEG;
 * local dev falls back to PNG when the Images binding is unavailable.
 *
 * The JPEG is cached in R2 (ASSETS_BUCKET, key "og-badges/{code}", or "og-badges/{code}/square")
 * on first render and served from cache on subsequent requests.
 */

import { requestDb } from "../../../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { readCachedBadge, serveGeneratedBadge } from "../../../../../_lib/services/og-badge-http";
import { renderBadgeSourcePng } from "../../../../../_lib/services/og-badge-prerender";

export async function onRequestGet(c: any): Promise<Response> {
  const code = c.req.param("code");
  const bucket = c.env.ASSETS_BUCKET;
  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  const url = new URL(c.req.raw.url);
  const parsed = personalPromotionImageQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success)
    return json(
      {
        error: { code: "VALIDATION_ERROR", message: "Choose a supported image format.", details: parsed.error.issues },
      },
      400,
    );
  const { format, download, name } = parsed.data;
  const r2Key = personalPromotionImageCacheKey(code, format);
  const isDownload = download === "1";
  const rawName = name ?? "";

  const source = await readBadgeSource(requestDb(c), code);
  if (!source) return json({ error: { code: "NOT_FOUND", message: "Unknown referral code" } }, 404);

  const responseOptions = {
    bucket,
    cacheKey: r2Key,
    cacheMetadata: personalBadgeCacheMetadata(code, source, format),
    isDownload,
    downloadName: rawName,
    fallbackDownloadName: format === "square" ? "attendee-badge-square" : "attendee-badge",
  };
  const cached = await readCachedBadge(responseOptions);
  if (cached) return cached;

  // Render the loaded source without another database roundtrip.
  let png: Uint8Array | null;
  try {
    png = await renderBadgeSourcePng(code, source, c.env, origin, format);
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
