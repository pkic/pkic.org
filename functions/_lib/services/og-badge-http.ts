import type { Env } from "../types";
import { applyDownloadDisposition } from "../utils/download-disposition";

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
}

function finalizeBadgeResponse(response: Response, options: BadgeResponseOptions): Response {
  return options.isDownload
    ? applyDownloadDisposition(response, options.downloadName, options.fallbackDownloadName)
    : response;
}

function badgeHeaders(contentType: string, cacheStatus: "HIT" | "MISS", isDownload: boolean): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": isDownload ? "no-store" : OG_BADGE_CACHE_CONTROL,
    "X-Cache": cacheStatus,
  };
}

export async function readCachedBadge(options: BadgeResponseOptions): Promise<Response | null> {
  const cached = await options.bucket?.get(options.cacheKey);
  if (!cached) return null;
  return finalizeBadgeResponse(
    new Response(await cached.arrayBuffer(), {
      headers: badgeHeaders(cached.httpMetadata?.contentType ?? JPEG_CONTENT_TYPE, "HIT", options.isDownload),
    }),
    options,
  );
}

export async function serveGeneratedBadge(
  png: Uint8Array,
  images: Env["IMAGES"],
  executionCtx: Pick<ExecutionContext, "waitUntil">,
  options: BadgeResponseOptions,
): Promise<Response> {
  if (options.bucket && images) {
    try {
      const pngStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(png);
          controller.close();
        },
      });
      const transformed = await images.input(pngStream).transform({}).output({ format: "image/jpeg", quality: 95 });
      const jpeg = await (await transformed.response()).arrayBuffer();
      executionCtx.waitUntil(
        options.bucket.put(options.cacheKey, jpeg, {
          httpMetadata: { contentType: JPEG_CONTENT_TYPE },
          customMetadata: options.cacheMetadata,
        }),
      );
      return finalizeBadgeResponse(
        new Response(jpeg, { headers: badgeHeaders(JPEG_CONTENT_TYPE, "MISS", options.isDownload) }),
        options,
      );
    } catch {
      // Local development and transient image-transform failures use the PNG.
    }
  }

  return finalizeBadgeResponse(
    new Response(png.buffer as ArrayBuffer, {
      headers: badgeHeaders(PNG_CONTENT_TYPE, "MISS", options.isDownload),
    }),
    options,
  );
}
