import { AppError } from "../errors";

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
