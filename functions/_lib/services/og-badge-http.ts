import type { Env } from "../types";
import { applyDownloadDisposition } from "../utils/download-disposition";
import { encodeRenderedPng, BADGE_IMAGE_OUTPUT, type RenderedImageOutput } from "../utils/image-encoding";

const JPEG_CONTENT_TYPE = "image/jpeg";
const PNG_CONTENT_TYPE = "image/png";
export const OG_BADGE_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600";

interface BadgeResponseOptions {
  bucket: Env["ASSETS_BUCKET"];
  cacheKey: string;
  cacheMetadata: Record<string, string>;
  isDownload: boolean;
  downloadName: string;
  fallbackDownloadName: string;
  /** The stored encoding; a full-size badge unless the caller asks for a thumbnail. */
  output?: RenderedImageOutput;
}

function finalizeBadgeResponse(response: Response, options: BadgeResponseOptions): Response {
  return options.isDownload
    ? applyDownloadDisposition(response, options.downloadName, options.fallbackDownloadName)
    : response;
}

function badgeHeaders(contentType: string, cacheStatus: "HIT" | "MISS", options: BadgeResponseOptions): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": options.isDownload
      ? "no-store"
      : options.cacheMetadata.badgeRenderer
        ? "public, no-cache"
        : OG_BADGE_CACHE_CONTROL,
    "X-Cache": cacheStatus,
  };
}

export async function readCachedBadge(options: BadgeResponseOptions): Promise<Response | null> {
  const cached = await options.bucket?.get(options.cacheKey);
  if (!cached) return null;
  for (const key of ["badgeGeneration", "badgeRenderer", "badgeDesignRevision", "badgeImageFormat"]) {
    if (options.cacheMetadata[key] !== undefined && cached.customMetadata?.[key] !== options.cacheMetadata[key])
      return null;
  }
  return finalizeBadgeResponse(
    new Response(await cached.arrayBuffer(), {
      headers: badgeHeaders(cached.httpMetadata?.contentType ?? JPEG_CONTENT_TYPE, "HIT", options),
    }),
    options,
  );
}

export async function serveGeneratedBadge(
  png: Uint8Array,
  env: Pick<Env, "IMAGES">,
  executionCtx: Pick<ExecutionContext, "waitUntil">,
  options: BadgeResponseOptions,
): Promise<Response> {
  let image = { bytes: png, contentType: PNG_CONTENT_TYPE };
  try {
    image = await encodeRenderedPng(env, png, options.output ?? BADGE_IMAGE_OUTPUT);
  } catch {
    // Local development and transient image-transform failures use the PNG.
  }
  // Only an encoded image is cached; a PNG fallback is rendered again next time.
  if (options.bucket && image.contentType !== PNG_CONTENT_TYPE)
    executionCtx.waitUntil(
      options.bucket.put(options.cacheKey, image.bytes, {
        httpMetadata: { contentType: image.contentType },
        customMetadata: options.cacheMetadata,
      }),
    );
  return finalizeBadgeResponse(
    new Response(image.bytes as Uint8Array<ArrayBuffer>, { headers: badgeHeaders(image.contentType, "MISS", options) }),
    options,
  );
}
