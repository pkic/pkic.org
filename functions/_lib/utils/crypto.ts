const encoder = new TextEncoder();

export async function sha256Hex(input: string | BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof input === "string" ? encoder.encode(input) : input);
  const bytes = new Uint8Array(digest);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares arbitrary strings without exposing an early-exit prefix or length comparison. */
export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const signature = await hmacSha256Bytes(secret, payload);
  return [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns the raw SHA-256 HMAC bytes for callers that apply their own wire encoding. */
export async function hmacSha256Bytes(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return new Uint8Array(signature);
}

/** Verifies a lowercase or uppercase hex HMAC without comparing secret-derived strings in application code. */
export async function verifyHmacSha256Hex(secret: string, payload: string, signatureHex: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(signatureHex)) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "verify",
  ]);
  const signature = new Uint8Array(signatureHex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(payload));
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
