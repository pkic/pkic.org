export const SUPPORTED_RASTER_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type RasterImageContentType = (typeof SUPPORTED_RASTER_IMAGE_CONTENT_TYPES)[number];
export type RasterImageExtension = "jpg" | "png" | "webp";

export interface DetectedImageFormat {
  contentType: RasterImageContentType;
  extension: RasterImageExtension;
}

export interface ValidatedRasterImage extends DetectedImageFormat {
  width: number;
  height: number;
}

export type RasterImageValidationResult =
  { ok: true; image: ValidatedRasterImage } | { ok: false; reason: "invalid" | "dimensions" };

/**
 * Limits decoded raster size before images are retained or embedded in SVG.
 * The byte limit remains caller-specific; these limits bound decoder memory.
 */
export const MAX_RASTER_IMAGE_DIMENSION = 4096;
// Eight million pixels caps an uncompressed RGBA frame at roughly 32 MB before
// decoder and SVG-renderer overhead, while still allowing high-resolution
// headshots and logos.
export const MAX_RASTER_IMAGE_PIXELS = 8_000_000;

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

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + bytes[offset + 3] * 0x1000000) >>> 0;
}

function isJpegSof(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;

    const marker = bytes[offset++];
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (isJpegSof(marker)) {
      if (segmentLength < 8) return null;
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG signature + IHDR length/type/data + CRC.
  if (bytes.length < 33 || readUint32BE(bytes, 8) !== 13) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function tagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
  return tag.split("").every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 20 || readUint32LE(bytes, 4) + 8 !== bytes.length) return null;

  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return null;
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkSize;
    if (dataEnd > bytes.length || dataEnd + (chunkSize % 2) > bytes.length) return null;

    if (tagAt(bytes, offset, "VP8X")) {
      if (chunkSize < 10) return null;
      const width = 1 + bytes[dataOffset + 4] + (bytes[dataOffset + 5] << 8) + (bytes[dataOffset + 6] << 16);
      const height = 1 + bytes[dataOffset + 7] + (bytes[dataOffset + 8] << 8) + (bytes[dataOffset + 9] << 16);
      return { width, height };
    }
    if (tagAt(bytes, offset, "VP8 ")) {
      if (
        chunkSize < 10 ||
        (bytes[dataOffset] & 1) !== 0 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        return null;
      }
      const width = readUint16LE(bytes, dataOffset + 6) & 0x3fff;
      const height = readUint16LE(bytes, dataOffset + 8) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (tagAt(bytes, offset, "VP8L")) {
      if (chunkSize < 5 || bytes[dataOffset] !== 0x2f) return null;
      const width = 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8);
      const height =
        1 +
        ((bytes[dataOffset + 2] & 0xc0) >> 6) +
        (bytes[dataOffset + 3] << 2) +
        ((bytes[dataOffset + 4] & 0x0f) << 10);
      return { width, height };
    }
    offset = dataEnd + (chunkSize % 2);
  }
  return null;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/**
 * Parses the dimensions carried by every accepted raster format and rejects
 * malformed or excessively large images before a decoder sees their pixels.
 */
export function validateRasterImage(input: ArrayBuffer | Uint8Array): RasterImageValidationResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const format = detectImageFormat(bytes);
  if (!format) return { ok: false, reason: "invalid" };

  const dimensions =
    format.contentType === "image/jpeg"
      ? parseJpegDimensions(bytes)
      : format.contentType === "image/png"
        ? parsePngDimensions(bytes)
        : parseWebpDimensions(bytes);
  if (!dimensions) return { ok: false, reason: "invalid" };
  if (
    dimensions.width > MAX_RASTER_IMAGE_DIMENSION ||
    dimensions.height > MAX_RASTER_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_RASTER_IMAGE_PIXELS
  ) {
    return { ok: false, reason: "dimensions" };
  }
  return { ok: true, image: { ...format, ...dimensions } };
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
