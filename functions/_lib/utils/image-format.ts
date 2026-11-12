import {
  JPEG_IMAGE as JPEG,
  PNG_IMAGE as PNG,
  WEBP_IMAGE as WEBP,
  detectImageFormat,
  type DetectedImageFormat,
  type RasterImageExtension,
} from "../../../assets/shared/image-signature";

export interface ValidatedRasterImage extends DetectedImageFormat {
  width: number;
  height: number;
}

export interface EmbeddedRasterImage extends ValidatedRasterImage {
  dataUrl: string;
}

export type RasterImageValidationResult =
  | { ok: true; image: ValidatedRasterImage }
  | { ok: false; reason: "invalid" | "dimensions" };

/**
 * Limits decoded raster size before images are retained or embedded in SVG.
 * The byte limit remains caller-specific; these limits bound decoder memory.
 */
export const MAX_RASTER_IMAGE_DIMENSION = 4096;
// Eight million pixels caps an uncompressed RGBA frame at roughly 32 MB before
// decoder and SVG-renderer overhead, while still allowing high-resolution
// headshots and logos.
export const MAX_RASTER_IMAGE_PIXELS = 8_000_000;

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
export function validateRasterImage(
  input: ArrayBuffer | Uint8Array,
  limits = { maxDimension: MAX_RASTER_IMAGE_DIMENSION, maxPixels: MAX_RASTER_IMAGE_PIXELS },
): RasterImageValidationResult {
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
    dimensions.width > limits.maxDimension ||
    dimensions.height > limits.maxDimension ||
    dimensions.width * dimensions.height > limits.maxPixels
  ) {
    return { ok: false, reason: "dimensions" };
  }
  return { ok: true, image: { ...format, ...dimensions } };
}

/** Reports declared transparency; unknown or malformed headers never authorize flattening. */
export function rasterImageHasTransparency(bytes: Uint8Array): boolean | null {
  const validated = validateRasterImage(bytes);
  if (!validated.ok) return null;
  if (validated.image.contentType === "image/jpeg") return false;
  if (validated.image.contentType === "image/png") {
    if (bytes[25] === 4 || bytes[25] === 6) return true;
    if (![0, 2, 3].includes(bytes[25]!)) return null;
    let offset = 33;
    while (offset + 12 <= bytes.length) {
      const end = offset + 12 + readUint32BE(bytes, offset);
      if (end > bytes.length) return null;
      if (tagAt(bytes, offset + 4, "tRNS")) return true;
      if (tagAt(bytes, offset + 4, "IDAT")) return false;
      offset = end;
    }
    return null;
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = readUint32LE(bytes, offset + 4);
    const start = offset + 8;
    const end = start + size + (size % 2);
    if (end > bytes.length) return null;
    // Animated backgrounds can be transparent even without the alpha flag.
    if (tagAt(bytes, offset, "VP8X")) return size >= 10 ? (bytes[start]! & 0x12) !== 0 : null;
    if (tagAt(bytes, offset, "ALPH")) return true;
    if (tagAt(bytes, offset, "VP8L"))
      return size >= 5 && bytes[start] === 0x2f ? (bytes[start + 4]! & 0x10) !== 0 : null;
    if (tagAt(bytes, offset, "VP8 ")) return false;
    offset = end;
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
