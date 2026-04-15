/**
 * OG Card image endpoint  GET /og/:path+/og.jpg
 *
 * Renders the Hugo-generated og-card.html page to a 1200×630 JPEG using
 * Cloudflare Browser Rendering, then caches the result on R2.
 *
 * Cache strategy:
 *   - A content hash (`v` query param) is embedded in the og:image URL by Hugo.
 *   - R2 stores one JPEG per page path with the hash in custom metadata.
 *   - When the hash matches → serve from R2 with immutable cache headers.
 *   - When the hash differs or no cached version exists → re-render, replace on R2.
 *   - Clients receive `Cache-Control: public, max-age=31536000, immutable` because
 *     the URL itself changes whenever the content hash changes.
 */

import puppeteer from "@cloudflare/puppeteer";
import { json } from "../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../_lib/config";

const JPEG_CONTENT_TYPE = "image/jpeg";
const R2_KEY_PREFIX = "og-cards/";
/** One year — effectively immutable since the URL changes with the content hash. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const OG_CARD_WIDTH = 1200;
const OG_CARD_HEIGHT = 630;

/** Normalise the path: strip slashes, collapse duplicates, remove .jpg suffix. */
function normalisePath(raw: string): string {
  return raw
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    .replace(/\.jpg$/i, "");
}

export async function onRequestGet(c: any): Promise<Response> {
  // Extract the page path from the URL — everything between /og/ and /og.jpg
  const url = new URL(c.req.raw.url);
  const pathMatch = url.pathname.match(/\/og\/(.+)\/og\.jpg$/);
  const rawPath = pathMatch?.[1] ?? "";
  let pagePath = normalisePath(rawPath);
  // "index" is used by the home page — maps to root og-card
  if (pagePath === "index") pagePath = "";
  if (!pagePath && !rawPath.match(/^(index(\.jpg)?)?$/i)) {
    return json({ error: { code: "BAD_REQUEST", message: "Missing page path" } }, 400);
  }

  const contentHash = url.searchParams.get("v") ?? "";
  const r2Key = `${R2_KEY_PREFIX}${pagePath || "index"}.jpg`;
  const bucket = c.env.ASSETS_BUCKET;
  const origin = resolveAppBaseUrl(c.env, c.req.raw);

  // 1. Serve from R2 if the cached version's hash matches
  if (bucket && contentHash) {
    const cached = await bucket.get(r2Key);
    if (cached && cached.customMetadata?.contentHash === contentHash) {
      return new Response(await cached.arrayBuffer(), {
        headers: {
          "Content-Type": JPEG_CONTENT_TYPE,
          "Cache-Control": CACHE_CONTROL,
          "X-Cache": "HIT",
        },
      });
    }
  }

  // 2. Render the og-card.html page with Browser Rendering
  if (!c.env.BROWSER) {
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Browser Rendering not available" } }, 503);
  }

  const ogCardUrl = pagePath ? `${origin}/${pagePath}/og-card.html` : `${origin}/og-card.html`;
  let jpegBuf: ArrayBuffer;

  const browser = await puppeteer.launch(c.env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: OG_CARD_WIDTH, height: OG_CARD_HEIGHT });
    await page.goto(ogCardUrl, { waitUntil: "networkidle0" });

    // Screenshot as JPEG directly (Puppeteer supports it natively)
    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 95,
      clip: { x: 0, y: 0, width: OG_CARD_WIDTH, height: OG_CARD_HEIGHT },
    });
    // Puppeteer returns a Buffer; convert to ArrayBuffer for R2 / Response
    const bytes = new Uint8Array(screenshot);
    jpegBuf = bytes.buffer;
  } finally {
    await browser.close();
  }

  // 3. Cache on R2 (fire-and-forget via waitUntil)
  if (bucket && contentHash) {
    c.executionCtx.waitUntil(
      bucket.put(r2Key, jpegBuf, {
        httpMetadata: { contentType: JPEG_CONTENT_TYPE },
        customMetadata: { contentHash, pagePath },
      }),
    );
  }

  return new Response(jpegBuf, {
    headers: {
      "Content-Type": JPEG_CONTENT_TYPE,
      "Cache-Control": contentHash ? CACHE_CONTROL : "public, max-age=86400, s-maxage=86400",
      "X-Cache": "MISS",
    },
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
