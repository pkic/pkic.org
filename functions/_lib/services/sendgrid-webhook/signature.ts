const MAX_WEBHOOK_AGE_SECONDS = 25 * 60 * 60;
const MAX_FUTURE_SKEW_SECONDS = 5 * 60;

function readDerLength(bytes: Uint8Array, offset: number): { length: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) throw new Error("Missing DER length");
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 2 || offset + count >= bytes.length) throw new Error("Invalid DER length");
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[offset + 1 + index]!;
  return { length, next: offset + 1 + count };
}

function readDerInteger(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (bytes[offset] !== 0x02) throw new Error("Expected DER INTEGER");
  const parsed = readDerLength(bytes, offset + 1);
  const end = parsed.next + parsed.length;
  if (parsed.length === 0 || end > bytes.length) throw new Error("Invalid DER INTEGER length");
  const raw = bytes.subarray(parsed.next, end);
  const value = raw[0] === 0 ? raw.subarray(1) : raw;
  if (value.length === 0 || value.length > 32) throw new Error("Invalid P-256 integer width");
  return { value, next: end };
}

/** Converts SendGrid's DER ECDSA signature to Web Crypto's IEEE P1363 r||s form. */
export function derToP1363(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("Expected DER SEQUENCE");
  const sequence = readDerLength(der, 1);
  if (sequence.next + sequence.length !== der.length) throw new Error("Invalid DER SEQUENCE length");
  const r = readDerInteger(der, sequence.next);
  const s = readDerInteger(der, r.next);
  if (s.next !== der.length) throw new Error("Trailing DER signature data");

  const result = new Uint8Array(64);
  result.set(r.value, 32 - r.value.length);
  result.set(s.value, 64 - s.value.length);
  return result;
}

export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isLoopbackOrigin(origin: string | null): boolean {
  if (!origin) return false;
  const hostname = new URL(origin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function timestampIsFresh(timestampHeader: string, nowSeconds: number): boolean {
  if (!/^\d{10}$/.test(timestampHeader)) return false;
  const timestamp = Number(timestampHeader);
  return timestamp <= nowSeconds + MAX_FUTURE_SKEW_SECONDS && timestamp >= nowSeconds - MAX_WEBHOOK_AGE_SECONDS;
}

export async function verifySendgridSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string,
  timestampHeader: string,
  publicKeyBase64: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!timestampIsFresh(timestampHeader, nowSeconds)) return false;
  try {
    const cleanKey = publicKeyBase64.replace(/-----[^-]+-----|[\r\n]/g, "");
    const publicKeyBytes = Uint8Array.from(atob(cleanKey), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "spki",
      publicKeyBytes.buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const derSignature = Uint8Array.from(atob(signatureHeader), (character) => character.charCodeAt(0));
    const timestampBytes = new TextEncoder().encode(timestampHeader);
    const signedBytes = new Uint8Array(timestampBytes.length + rawBody.byteLength);
    signedBytes.set(timestampBytes);
    signedBytes.set(new Uint8Array(rawBody), timestampBytes.length);
    return crypto.subtle.verify(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      key,
      derToP1363(derSignature).buffer as ArrayBuffer,
      signedBytes.buffer as ArrayBuffer,
    );
  } catch {
    return false;
  }
}
