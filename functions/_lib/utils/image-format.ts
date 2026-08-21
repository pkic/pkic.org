export const SUPPORTED_RASTER_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type RasterImageContentType = (typeof SUPPORTED_RASTER_IMAGE_CONTENT_TYPES)[number];
export type RasterImageExtension = "jpg" | "png" | "webp";

export interface DetectedImageFormat {
  contentType: RasterImageContentType;
  extension: RasterImageExtension;
}

const JPEG: DetectedImageFormat = { contentType: "image/jpeg", extension: "jpg" };
const PNG: DetectedImageFormat = { contentType: "image/png", extension: "png" };
const WEBP: DetectedImageFormat = { contentType: "image/webp", extension: "webp" };

/** Detects the supported raster format from its minimum unambiguous signature. */
export function detectImageFormat(input: ArrayBuffer | Uint8Array): DetectedImageFormat | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return JPEG;
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
    return PNG;
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
    return WEBP;
  }
  return null;
}

export function imageExtensionForContentType(contentType: string): RasterImageExtension {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

/** Retains the email-attachment fallback policy when stored bytes have no recognized signature. */
export function resolveImageAttachmentFormat(contentType: string, bytes: Uint8Array): DetectedImageFormat {
  const detected = detectImageFormat(bytes);
  if (detected) return detected;
  const declaredType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (declaredType === "image/png") return PNG;
  if (declaredType === "image/webp") return WEBP;
  return JPEG;
}
