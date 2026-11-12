/**
 * Raster image formats recognized by their leading bytes, never by a declared
 * type: the one signature check the Worker's image handling and the event
 * screens share.
 */
export const SUPPORTED_RASTER_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type RasterImageContentType = (typeof SUPPORTED_RASTER_IMAGE_CONTENT_TYPES)[number];
export type RasterImageExtension = "jpg" | "png" | "webp";

export interface DetectedImageFormat {
  contentType: RasterImageContentType;
  extension: RasterImageExtension;
}

export const JPEG_IMAGE: DetectedImageFormat = { contentType: "image/jpeg", extension: "jpg" };
export const PNG_IMAGE: DetectedImageFormat = { contentType: "image/png", extension: "png" };
export const WEBP_IMAGE: DetectedImageFormat = { contentType: "image/webp", extension: "webp" };

/** Detects the supported raster format from its minimum unambiguous signature. */
export function detectImageFormat(input: ArrayBuffer | Uint8Array): DetectedImageFormat | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return JPEG_IMAGE;
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return PNG_IMAGE;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return WEBP_IMAGE;
  }
  return null;
}
