import { AppError } from "../errors";
import { STANDARD_HEADSHOT_MAX_BYTES } from "../../../assets/shared/schemas/images";
import { validateRasterImage } from "../utils/image-format";

// Imported camera originals are served without decoding in the Worker.
// These bounds cover the retained repository portraits; upload/renderer
// limits remain independent and smaller.
const IMPORTED_PORTRAIT_MAX_BYTES = 10 * 1024 * 1024;
const IMPORTED_PORTRAIT_LIMITS = { maxDimension: 8192, maxPixels: 32_000_000 };

export const PUBLIC_IMAGE_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600";

function storedImageContentType(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "image/jpeg";
}

/** Serves a stored image with one MIME/cache policy and a sandbox for legacy SVG assets. */
export async function storedImageResponse(
  bucket: R2Bucket,
  key: string,
  options: { notFoundCode: string; notFoundMessage: string; cacheControl: string },
): Promise<Response> {
  const object = await bucket.get(key);
  if (!object) throw new AppError(404, options.notFoundCode, options.notFoundMessage);
  return new Response(await object.arrayBuffer(), {
    headers: {
      "Content-Type": storedImageContentType(key),
      "Cache-Control": options.cacheControl,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Serves a retained headshot with bounded byte and pixel dimensions.
 * R2 exposes the object size before its body is read, so legacy objects never
 * cause an unbounded buffer at a Worker response boundary.
 */
export async function storedRasterImageResponse(
  bucket: R2Bucket,
  key: string,
  options: { notFoundCode: string; notFoundMessage: string; cacheControl: string },
  maxBytes = key.startsWith("member-photos/") ? IMPORTED_PORTRAIT_MAX_BYTES : STANDARD_HEADSHOT_MAX_BYTES,
): Promise<Response> {
  const object = await bucket.get(key);
  if (!object || object.size > maxBytes) {
    throw new AppError(404, options.notFoundCode, options.notFoundMessage);
  }

  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new AppError(404, options.notFoundCode, options.notFoundMessage);
  }
  // Repository imports retain camera originals (including 12 MP portraits).
  // Serving those bytes does not decode them in the Worker. Uploads and badge
  // rendering keep the stricter default decoder limits.
  const validation = validateRasterImage(
    bytes,
    key.startsWith("member-photos/") ? IMPORTED_PORTRAIT_LIMITS : undefined,
  );
  if (!validation.ok) {
    throw new AppError(404, options.notFoundCode, options.notFoundMessage);
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": validation.image.contentType,
      "Cache-Control": options.cacheControl,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
