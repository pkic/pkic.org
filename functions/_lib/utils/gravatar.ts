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

export interface DownloadedGravatar {
  buffer: ArrayBuffer;
  contentType: string;
}

/** Downloads a custom Gravatar without mutating D1 or R2. */
export async function downloadGravatar(email: string): Promise<DownloadedGravatar | null> {
  const emailHash = await gravatarHash(email);
  const response = await fetch(`https://gravatar.com/avatar/${emailHash}?s=${GRAVATAR_SIZE}&d=404`);
  if (!response.ok) return null;
  const contentType = (response.headers.get("content-type") ?? "image/jpeg").split(";", 1)[0].trim();
  return { buffer: await response.arrayBuffer(), contentType };
}
