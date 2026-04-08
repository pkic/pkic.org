/**
 * OG Badge image endpoint  GET /api/v1/og/:code
 *
 * Returns a personalised 1200x630 social-sharing badge for the person
 * associated with the given referral code. The production path serves JPEG;
 * local dev falls back to PNG when the Images binding is unavailable.
 *
 * The JPEG is cached in R2 (ASSETS_BUCKET, key "og-badges/{code}")
 * on first render and served from cache on subsequent requests.
 */

import { json } from "../../../_lib/http";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { generateBadgePng } from "../../../_lib/services/og-badge-prerender";
import { applyDownloadDisposition } from "../../../_lib/utils/download-disposition";

const JPEG_CONTENT_TYPE = "image/jpeg";
const PNG_CONTENT_TYPE  = "image/png";  // fallback when IMAGES binding unavailable
const CACHE_CONTROL     = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600";
const R2_KEY_PREFIX     = "og-badges/";

export async function onRequestGet(c: any): Promise<Response> {
  const code = c.req.param("code");
  const r2Key    = `${R2_KEY_PREFIX}${code}`;
  const bucket   = c.env.ASSETS_BUCKET;
  const origin   = resolveAppBaseUrl(c.env, c.req.raw);
  const url      = new URL(c.req.raw.url);
  const isDownload = url.searchParams.get("download") === "1";
  const rawName = url.searchParams.get("name") ?? "";

  // 1. Serve from R2 cache if available (always stored as JPEG)
  if (bucket) {
    const cached = await bucket.get(r2Key);
    if (cached) {
      const cachedContentType = cached.httpMetadata?.contentType ?? JPEG_CONTENT_TYPE;
      const response = new Response(await cached.arrayBuffer(), {
        headers: {
          "Content-Type": cachedContentType,
          "Cache-Control": isDownload ? "no-store" : CACHE_CONTROL,
          "X-Cache": "HIT",
        },
      });
      return isDownload ? applyDownloadDisposition(response, rawName, "attendee-badge") : response;
    }
  }

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

  // 3. Convert PNG → JPEG via the Images binding and cache.
  //    If the binding is unavailable (local dev), serve the raw PNG without caching.
  if (bucket && c.env.IMAGES) {
    try {
      const pngStream = new ReadableStream<Uint8Array>({
        start(ctrl) { ctrl.enqueue(png as Uint8Array); ctrl.close(); },
      });
      const result  = await c.env.IMAGES.input(pngStream).transform({}).output({ format: "image/jpeg", quality: 90 });
      const jpegBuf = await (await result.response()).arrayBuffer();
      c.executionCtx.waitUntil(
        bucket.put(r2Key, jpegBuf, {
          httpMetadata: { contentType: JPEG_CONTENT_TYPE },
          customMetadata: { referralCode: code },
        }),
      );
      const response = new Response(jpegBuf, {
        headers: {
          "Content-Type": JPEG_CONTENT_TYPE,
          "Cache-Control": isDownload ? "no-store" : CACHE_CONTROL,
          "X-Cache": "MISS",
        },
      });
      return isDownload ? applyDownloadDisposition(response, rawName, "attendee-badge") : response;
    } catch { /* fall through to raw PNG */ }
  }

  // Fallback: serve raw PNG (IMAGES binding not configured or conversion failed)
  const response = new Response(png.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": PNG_CONTENT_TYPE,
      "Cache-Control": isDownload ? "no-store" : CACHE_CONTROL,
      "X-Cache": "MISS",
    },
  });
  return isDownload ? applyDownloadDisposition(response, rawName, "attendee-badge") : response;
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
