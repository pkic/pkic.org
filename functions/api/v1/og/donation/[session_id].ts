/**
 * GET /api/v1/og/donation/:session_id
 *
 * Returns a personalised 1200×630 JPEG donation badge for sharing on social
 * media. The badge shows the donor's name, the amount donated, and a
 * "Match this donation!" CTA, styled to match the PKI Consortium brand.
 *
 * Only returns a badge for completed (paid) donations — pending or missing
 * sessions receive 202 { pending: true } or 404.
 *
 * The JPEG is cached in R2 (ASSETS_BUCKET, key "og-badges/donation-{session_id}")
 * on first render and served from cache on subsequent requests.
 */

import { json } from "../../../../_lib/http";
import { generateDonationBadgePng } from "../../../../_lib/services/og-badge-prerender";
import type { PagesContext } from "../../../../_lib/types";

const JPEG_CONTENT_TYPE = "image/jpeg";
const PNG_CONTENT_TYPE  = "image/png";
const CACHE_CONTROL     = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600";
const R2_KEY_PREFIX     = "og-badges/donation-";

export async function onRequestGet(
  context: PagesContext<{ session_id: string }>,
): Promise<Response> {
  const { session_id } = context.params;
  const bucket = context.env.ASSETS_BUCKET;
  const origin = new URL(context.request.url).origin;
  const url    = new URL(context.request.url);

  if (!session_id || !session_id.startsWith("cs_")) {
    return json({ error: "Invalid session_id" }, 400);
  }

  const isDownload = url.searchParams.get("download") === "1";
  const extraHeaders: Record<string, string> = {};
  if (isDownload) {
    const rawName  = url.searchParams.get("name") ?? "donation-badge";
    const safeName = rawName.replace(/[^\w\-. ]/g, "").trim().replace(/\.jpe?g$/i, "") || "donation-badge";
    extraHeaders["Content-Disposition"] = `attachment; filename="${safeName}.jpg"`;
  }

  const r2Key = `${R2_KEY_PREFIX}${session_id}`;

  // 1. Serve from R2 cache if available
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

  // 2. Generate PNG
  let png: Uint8Array | null;
  try {
    png = await generateDonationBadgePng(session_id, context.env, origin);
  } catch {
    return new Response("Badge rendering unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }

  if (!png) {
    // Not found or not yet completed — same 202 pattern as /api/v1/donations/session
    return json({ pending: true }, 202);
  }

  // 3. Convert PNG → JPEG, cache, serve
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
          customMetadata: { sessionId: session_id },
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
    } catch { /* fall through to PNG fallback */ }
  }

  // Fallback: serve raw PNG (local dev — no IMAGES binding)
  return new Response(png.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": PNG_CONTENT_TYPE,
      "Cache-Control": "no-store",
      "X-Cache": "MISS",
      ...extraHeaders,
    },
  });
}
