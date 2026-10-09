import type { HeadshotVariantWidth } from "../../../assets/shared/headshot-variants";
import type { ImagesBinding } from "../types";
import { validateRasterImage } from "../utils/image-format";
import { rasterImageResponse, readStoredRasterImage } from "./image-response";

/**
 * Small square renditions of the current headshot, made on request.
 *
 * Nothing is stored: a rendition is derived from the object the user's row
 * names, after the caller has checked that row, so revocation is exactly the
 * full image's — a replaced or removed portrait stops resolving at once, and
 * no sibling object needs its own deletion or a backfill.
 *
 * The Images binding does the decoding, so the Worker never decodes pixels;
 * its own work is the bounded R2 read the full image already performs. The
 * rendition is kept in this data center's Cache API under the stored key, so
 * repeat views skip the transform. That cache sits behind the row check and is
 * never answered directly to a visitor, which is why it may live longer than
 * the browser-facing policy.
 */
const RENDITION_CACHE_CONTROL = "public, max-age=86400";
const RENDITION_QUALITY = 82;
const NOT_FOUND = { notFoundCode: "NOT_FOUND", notFoundMessage: "Headshot not found" };

export interface HeadshotRenditionRequest {
  bucket: R2Bucket;
  storedKey: string;
  userId: string;
  width: HeadshotVariantWidth;
  /** Absent in local tooling without the binding; the stored portrait is served instead. */
  images?: ImagesBinding;
  /** Origin the internal cache key is placed under. */
  origin: string;
  /** The browser-facing policy, identical to the full image's. */
  cacheControl: string;
}

function renditionCacheKey(request: HeadshotRenditionRequest): Request {
  // Outside the API paths so a cache key can never be mistaken for a served address.
  const key = new URL(`/__cache/headshot-renditions/${encodeURIComponent(request.userId)}`, request.origin);
  key.searchParams.set("source", request.storedKey);
  key.searchParams.set("width", request.width);
  return new Request(key.toString());
}

/** A named cache keeps renditions apart from any other cached response of this Worker. */
async function renditionCache(): Promise<Cache | undefined> {
  return typeof caches === "undefined" ? undefined : caches.open("headshot-renditions");
}

async function transformHeadshot(
  images: ImagesBinding,
  bytes: ArrayBuffer,
  width: number,
): Promise<ArrayBuffer | null> {
  try {
    const result = await images
      .input(new Response(bytes).body!)
      .transform({ width, height: width, fit: "cover" })
      .output({ format: "image/webp", quality: RENDITION_QUALITY });
    const rendition = await (await result.response()).arrayBuffer();
    const validation = validateRasterImage(rendition);
    return validation.ok && validation.image.contentType === "image/webp" ? rendition : null;
  } catch (error) {
    console.error("Headshot rendition transform failed:", error);
    return null;
  }
}

/** Serves one bounded rendition, or the stored portrait when no rendition can be made. */
export async function userHeadshotRenditionResponse(request: HeadshotRenditionRequest): Promise<Response> {
  const cache = await renditionCache();
  const cacheKey = renditionCacheKey(request);
  const cached = await cache?.match(cacheKey);
  if (cached) return rasterImageResponse(await cached.arrayBuffer(), "image/webp", request.cacheControl);

  const original = await readStoredRasterImage(request.bucket, request.storedKey, NOT_FOUND);
  const rendition = request.images
    ? await transformHeadshot(request.images, original.bytes, Number(request.width))
    : null;
  if (!rendition) return rasterImageResponse(original.bytes, original.contentType, request.cacheControl);

  try {
    await cache?.put(cacheKey, rasterImageResponse(rendition.slice(0), "image/webp", RENDITION_CACHE_CONTROL));
  } catch (error) {
    // A missed cache write only costs the next request another transform.
    console.error("Headshot rendition cache write failed:", error);
  }
  return rasterImageResponse(rendition, "image/webp", request.cacheControl);
}
