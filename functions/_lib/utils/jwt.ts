/**
 * Minimal HS256 JWT utility using the Web Crypto API (Workers-compatible).
 * Used for signed admin tokens where tamper-proof claims need to travel through
 * the client.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlBytes(bytes: Uint8Array): string {
  // Base64url-encode raw bytes (no UTF-8 transformation).
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeBytes(input: string): Uint8Array {
  const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function b64url(input: string): string {
  // UTF-8 safe base64url for JSON strings.
  return b64urlBytes(encoder.encode(input));
}

function b64urlDecode(input: string): string {
  return decoder.decode(b64urlDecodeBytes(input));
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  // Raw signature bytes must be base64url'd directly — UTF-8 encoding them would
  // mangle bytes >= 0x80 and produce non-standard JWT signatures.
  return b64urlBytes(new Uint8Array(sig));
}

async function hmacVerify(secret: string, payload: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, payload);
  if (expected.length !== signature.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export type JwtVerifyResult<TClaims> = { ok: true; claims: TClaims } | { ok: false; reason: "invalid" | "expired" };

export async function signJwt(secret: string, claims: Record<string, unknown>): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const sig = await hmacSign(secret, `${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export async function verifyJwt<TClaims extends object>(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<TClaims>> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const [header, payload, sig] = parts;
  const valid = await hmacVerify(secret, `${header}.${payload}`, sig);
  if (!valid) return { ok: false, reason: "invalid" };

  let claims: TClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload)) as TClaims;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const exp = (claims as Record<string, unknown>)["exp"];
  if (!Number.isFinite(exp as number)) {
    return { ok: false, reason: "invalid" };
  }
  if (typeof exp === "number" && Math.floor(Date.now() / 1000) > exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims };
}

export interface AdminManageClaims {
  /** Registration ID */
  sub: string;
  /** Event slug */
  event: string;
  /** sha256(ip) of the issuing request */
  iphash: string;
  /** sha256(ua) of the issuing request */
  uahash: string;
  /** Unix timestamp (seconds) */
  exp: number;
}

export async function signAdminManageJwt(
  secret: string,
  claims: Omit<AdminManageClaims, "exp"> & { ttlSeconds: number },
): Promise<string> {
  return signJwt(secret, {
    sub: claims.sub,
    event: claims.event,
    iphash: claims.iphash,
    uahash: claims.uahash,
    exp: Math.floor(Date.now() / 1000) + claims.ttlSeconds,
  });
}

export type AdminManageJwtVerifyResult = JwtVerifyResult<AdminManageClaims>;

export async function verifyAdminManageJwt(secret: string, token: string): Promise<AdminManageJwtVerifyResult> {
  return verifyJwt<AdminManageClaims>(secret, token);
}
