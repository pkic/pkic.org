import type { ImagesBinding } from "../types";
import { readBoundedStream } from "../utils/bounded-stream";
import { validateRasterImage } from "../utils/image-format";
import { rasterImageResponse, readStoredRasterImage } from "./image-response";
import { STANDARD_HEADSHOT_MAX_BYTES } from "../../../assets/shared/schemas/images";

interface RasterRenditionRequest {
  bucket: R2Bucket;
  storedKey: string;
  ownerId: string;
  namespace: "headshot-renditions" | "event-hero-renditions";
  width: number;
  height?: number;
  fit: "cover" | "scale-down";
  images?: ImagesBinding;
  origin: string;
  cacheControl: string;
  maxSourceBytes?: number;
  notFound: { notFoundCode: string; notFoundMessage: string };
}

/** Internal cached bytes are released only after the caller checks the current owner row. */
export async function storedRasterRenditionResponse(request: RasterRenditionRequest): Promise<Response> {
  const key = new URL(`/__cache/${request.namespace}/${encodeURIComponent(request.ownerId)}`, request.origin);
  key.searchParams.set("source", request.storedKey);
  key.searchParams.set("width", String(request.width));
  key.searchParams.set("height", String(request.height ?? "auto"));
  key.searchParams.set("fit", request.fit);
  const cacheKey = new Request(key.toString());
  const cache = typeof caches === "undefined" ? undefined : await caches.open(request.namespace);
  const cached = await cache?.match(cacheKey);
  if (cached) return rasterImageResponse(await cached.arrayBuffer(), "image/webp", request.cacheControl);

  const original = await readStoredRasterImage(
    request.bucket,
    request.storedKey,
    request.notFound,
    request.maxSourceBytes,
  );
  let rendition: ArrayBuffer | null = null;
  if (request.images) {
    try {
      const result = await request.images
        .input(new Response(original.bytes).body!)
        .transform({ width: request.width, ...(request.height ? { height: request.height } : {}), fit: request.fit })
        .output({ format: "image/webp", quality: 82 });
      const transformed = await readBoundedStream(result.response().body, STANDARD_HEADSHOT_MAX_BYTES);
      if (transformed.ok) {
        const validated = validateRasterImage(transformed.bytes);
        if (validated.ok && validated.image.contentType === "image/webp") rendition = transformed.bytes.buffer;
      }
    } catch (error) {
      console.error("Image rendition transform failed:", error);
    }
  }
  if (!rendition) return rasterImageResponse(original.bytes, original.contentType, request.cacheControl);
  try {
    await cache?.put(cacheKey, rasterImageResponse(rendition.slice(0), "image/webp", "public, max-age=86400"));
  } catch (error) {
    // A failed cache write only costs the next request another transform.
    console.error("Image rendition cache write failed:", error);
  }
  return rasterImageResponse(rendition, "image/webp", request.cacheControl);
}
