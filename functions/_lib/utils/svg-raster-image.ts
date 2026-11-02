import { bytesToBase64 } from "../../../assets/shared/base64";
import type { ImagesBinding } from "../types";
import { readBoundedStream } from "./bounded-stream";
import { validateRasterImage, type EmbeddedRasterImage } from "./image-format";

/** resvg decodes PNG and JPEG, so normalize other accepted raster sources before embedding. */
export async function svgRasterImage(
  source: Uint8Array<ArrayBuffer>,
  images: ImagesBinding | undefined,
  maxBytes: number,
  format: "image/png" | "image/jpeg" = "image/png",
): Promise<EmbeddedRasterImage | null> {
  const original = validateRasterImage(source);
  if (!original.ok) return null;
  let bytes = source;
  let image = original.image;
  if (image.contentType === "image/webp" || bytes.byteLength > maxBytes) {
    if (!images) return null;
    // PNG preserves transparent portraits; large opaque photographs use JPEG compression.
    const outputFormat = image.contentType === "image/jpeg" ? "image/jpeg" : format;
    const result = await images
      .input(new Response(bytes).body!)
      .transform({})
      .output({ format: outputFormat, quality: 95 });
    const response = await result.response();
    if (!response.ok || !response.body) return null;
    const bounded = await readBoundedStream(response.body, maxBytes, "SVG image exceeds the export byte budget");
    if (!bounded.ok) return null;
    bytes = bounded.bytes;
    const normalized = validateRasterImage(bytes);
    if (!normalized.ok || normalized.image.contentType !== outputFormat) return null;
    image = normalized.image;
  }
  if (bytes.byteLength > maxBytes) return null;
  return { ...image, dataUrl: `data:${image.contentType};base64,${bytesToBase64(bytes)}` };
}
