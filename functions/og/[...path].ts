/**
 * OG Card image endpoint  GET /og/:path+/og.jpg
 *
 * Renders the Hugo-generated og-card.html page to a 1200×630 JPEG using
 * Cloudflare Browser Rendering, then caches the result on R2.
 *
 * Cache strategy:
 *   - A content hash (`v` query param) is embedded in the og:image URL by Hugo.
 *   - R2 stores one JPEG per published page-path/content-hash pair.
 *   - A cache miss is rendered only when the generated og-card.html advertises
 *     the same content hash. Invented paths or versions never launch a browser.
 *   - Clients receive `Cache-Control: public, max-age=31536000, immutable` because
 *     the URL itself changes whenever the content hash changes.
 */

import puppeteer from "@cloudflare/puppeteer";
import { dispatchRequestMethod, json } from "../_lib/http";
import { resolveAppBaseUrl } from "../_lib/config";
import { getStaticAssetsBinding } from "../_lib/static-assets";
import type { Env } from "../_lib/types";
import { readBoundedStream } from "../_lib/utils/bounded-stream";

const JPEG_CONTENT_TYPE = "image/jpeg";
const R2_KEY_PREFIX = "og-cards/";
/** One year — effectively immutable since the URL changes with the content hash. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const OG_CARD_WIDTH = 1200;
const OG_CARD_HEIGHT = 630;
const MAX_PAGE_PATH_LENGTH = 512;
const MAX_OG_CARD_HTML_BYTES = 1024 * 1024;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{12}$/;
const VERSION_META_PATTERN = /<meta\s+name=["']pkic-og-card-version["']\s+content=["']([a-f0-9]{12})["']\s*\/?>/i;

export interface OgCardRequest {
  pagePath: string;
  contentHash: string;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function isSafePagePath(rawPath: string): boolean {
  if (rawPath.length === 0 || rawPath.length > MAX_PAGE_PATH_LENGTH) return false;
  return rawPath.split("/").every((rawSegment) => {
    if (!rawSegment) return false;
    let decoded = rawSegment;
    // URL implementations and asset layers can decode at different stages.
    // Reject a dangerous representation at any of the first few layers while
    // still accepting Hugo's ordinary single-encoded Unicode slugs.
    for (let depth = 0; depth < 3; depth += 1) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        return false;
      }
      if (
        decoded === "." ||
        decoded === ".." ||
        decoded.includes("/") ||
        decoded.includes("\\") ||
        containsControlCharacter(decoded)
      ) {
        return false;
      }
      if (!/%[0-9a-f]{2}/i.test(decoded)) break;
    }
    return decoded.length > 0 && !/%[0-9a-f]{2}/i.test(decoded);
  });
}

/** Parse the canonical route shape and version grammar emitted by Hugo. */
export function parseOgCardRequest(request: Request): OgCardRequest | null {
  const url = new URL(request.url);
  const pathMatch = /^\/og\/(.+)\/og\.jpg$/.exec(url.pathname);
  const rawPath = pathMatch?.[1] ?? "";
  const versions = url.searchParams.getAll("v");
  const contentHash = versions.length === 1 ? versions[0] : "";
  if (!isSafePagePath(rawPath) || !CONTENT_HASH_PATTERN.test(contentHash)) {
    return null;
  }
  return { pagePath: rawPath === "index" ? "" : rawPath, contentHash };
}

/** Read the build-generated marker that authorizes this exact render/cache fill. */
export async function publishedOgCardVersion(env: Env, origin: string, pagePath: string): Promise<string | null> {
  const assets = getStaticAssetsBinding(env);
  if (!assets) return null;
  const targetPath = pagePath ? `/${pagePath}/og-card.html` : "/og-card.html";
  const response = await assets.fetch(new Request(new URL(targetPath, origin)));
  if (!response.ok || !response.body) return null;
  const bounded = await readBoundedStream(response.body, MAX_OG_CARD_HTML_BYTES, "OG card HTML exceeds byte limit");
  if (!bounded.ok) return null;
  const html = new TextDecoder().decode(bounded.bytes);
  return VERSION_META_PATTERN.exec(html)?.[1]?.toLowerCase() ?? null;
}

export async function onRequestGet(c: any): Promise<Response> {
  const parsed = parseOgCardRequest(c.req.raw);
  if (!parsed) {
    return json({ error: { code: "BAD_REQUEST", message: "Invalid OG card path or version" } }, 400);
  }

  const { pagePath, contentHash } = parsed;
  const r2Key = `${R2_KEY_PREFIX}${pagePath || "index"}/${contentHash}.jpg`;
  const bucket = c.env.ASSETS_BUCKET;
  const origin = resolveAppBaseUrl(c.env, c.req.raw);

  // 1. A versioned R2 key is written only after the published-version check.
  if (bucket) {
    const cached = await bucket.get(r2Key);
    if (cached && cached.customMetadata?.contentHash === contentHash && cached.customMetadata?.pagePath === pagePath) {
      return new Response(await cached.arrayBuffer(), {
        headers: {
          "Content-Type": JPEG_CONTENT_TYPE,
          "Cache-Control": CACHE_CONTROL,
          "X-Cache": "HIT",
        },
      });
    }
  }

  // 2. A miss is authorized by the version marker in the static render target.
  if (!getStaticAssetsBinding(c.env)) {
    return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Static assets not available" } }, 503);
  }
  if ((await publishedOgCardVersion(c.env, origin, pagePath)) !== contentHash) {
    return json({ error: { code: "NOT_FOUND", message: "OG card version not found" } }, 404);
  }

  // 3. Render the authorized og-card.html page with Browser Rendering.
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

  // 4. Cache the authorized path/version pair on R2 (fire-and-forget).
  if (bucket) {
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
      "Cache-Control": CACHE_CONTROL,
      "X-Cache": "MISS",
    },
  });
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
