/**
 * OG Badge image endpoint  GET /api/v1/og/:code
 *
 * Returns a personalised 1200x630 JPEG social-sharing badge for the person
 * associated with the given referral code.
 *
 * The JPEG is cached in R2 (ASSETS_BUCKET, key "og-badges/{code}")
 * on first render and served from cache on subsequent requests.
 */

import { json } from "../../../_lib/http";
import { generateBadgePng } from "../../../_lib/services/og-badge-prerender";
import type { PagesContext } from "../../../_lib/types";

const JPEG_CONTENT_TYPE = "image/jpeg";
const PNG_CONTENT_TYPE  = "image/png";  // fallback when IMAGES binding unavailable
const CACHE_CONTROL     = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600";
const R2_KEY_PREFIX     = "og-badges/";

export async function onRequestGet(context: PagesContext<{ code: string }>): Promise<Response> {
  const { code } = context.params;
  const r2Key    = `${R2_KEY_PREFIX}${code}`;
  const bucket   = context.env.ASSETS_BUCKET;
  const origin   = new URL(context.request.url).origin;
  const url      = new URL(context.request.url);
  const isDownload = url.searchParams.get("download") === "1";

  const extraHeaders: Record<string, string> = {};
  if (isDownload) {
    const rawName  = url.searchParams.get("name") ?? "";
    const safeName = rawName.replace(/[^\w\-. ]/g, "").trim().replace(/\.jpe?g$/i, "") || "attendee-badge";
    extraHeaders["Content-Disposition"] = `attachment; filename="${safeName}.jpg"`;
  }

  // 1. Serve from R2 cache if available (always stored as JPEG)
  if (bucket) {
    const cached = await bucket.get(r2Key);
    if (cached) {
      return new Response(await cached.arrayBuffer(), {
        headers: {
          "Content-Type": JPEG_CONTENT_TYPE,
          "Cache-Control": isDownload ? "no-store" : CACHE_CONTROL,
          "X-Cache": "HIT",
          ...extraHeaders,
        },
      });
    }
  }

  // 2. Generate PNG (wasm init + fonts + DB + render, all parallelised)
  let png: Uint8Array | null;
  try {
    png = await generateBadgePng(code, context.env, origin);
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
  if (bucket && context.env.IMAGES) {
    try {
      const pngStream = new ReadableStream<Uint8Array>({
        start(ctrl) { ctrl.enqueue(png as Uint8Array); ctrl.close(); },
      });
      const result  = await context.env.IMAGES.input(pngStream).transform({}).output({ format: "image/jpeg", quality: 85 });
      const jpegBuf = await (await result.response()).arrayBuffer();
      context.waitUntil(
        bucket.put(r2Key, jpegBuf, {
          httpMetadata: { contentType: JPEG_CONTENT_TYPE },
          customMetadata: { referralCode: code },
        }),
      );
      return new Response(jpegBuf, {
        headers: {
          "Content-Type": JPEG_CONTENT_TYPE,
          "Cache-Control": isDownload ? "no-store" : CACHE_CONTROL,
          "X-Cache": "MISS",
          ...extraHeaders,
        },
      });
    } catch { /* fall through to raw PNG */ }
  }

  // Fallback: serve raw PNG (IMAGES binding not configured or conversion failed)
  return new Response(png.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": PNG_CONTENT_TYPE,
      "Cache-Control": isDownload ? "no-store" : CACHE_CONTROL,
      "X-Cache": "MISS",
      ...extraHeaders,
    },
  });
}

export async function onRequest(context: PagesContext<{ code: string }>): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
