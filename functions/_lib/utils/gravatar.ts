import { STANDARD_HEADSHOT_MAX_BYTES } from "../../../assets/shared/schemas/images";
import { readBoundedStream } from "./bounded-stream";
import { validateRasterImage } from "./image-format";

/**
 * Compute the Gravatar avatar hash for an email address.
 *
 * Gravatar migrated from MD5 to SHA-256 in 2024. The Web Crypto API supports
 * SHA-256 natively so no custom implementation is needed.
 *
 * Usage: `const hash = await gravatarHash(email);`
 * URL:   `https://gravatar.com/avatar/${hash}`
 */
export async function gravatarHash(email: string): Promise<string> {
  const input = email.trim().toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const GRAVATAR_SIZE = 512;
export const MAX_GRAVATAR_BYTES = STANDARD_HEADSHOT_MAX_BYTES;

export interface DownloadedGravatar {
  buffer: ArrayBuffer;
  contentType: string;
}

/**
 * Downloads a custom Gravatar without mutating D1 or R2.
 *
 * Every caller receives a byte-bounded, structurally validated raster image,
 * so administrative imports cannot bypass the normal upload boundary.
 */
export async function downloadGravatar(email: string): Promise<DownloadedGravatar | null> {
  const emailHash = await gravatarHash(email);
  const response = await fetch(`https://gravatar.com/avatar/${emailHash}?s=${GRAVATAR_SIZE}&d=404`);
  if (!response.ok) return null;

  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) return null;
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_GRAVATAR_BYTES) return null;
  }

  const result = await readBoundedStream(response.body, MAX_GRAVATAR_BYTES, "Gravatar exceeds the byte limit");
  if (!result.ok) return null;
  const validation = validateRasterImage(result.bytes);
  if (!validation.ok) return null;

  const buffer = result.bytes.buffer.slice(
    result.bytes.byteOffset,
    result.bytes.byteOffset + result.bytes.byteLength,
  ) as ArrayBuffer;
  return { buffer, contentType: validation.image.contentType };
}
