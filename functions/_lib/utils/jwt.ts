/**
 * Minimal HS256 JWT utility using the Web Crypto API (Workers-compatible).
 * Used for short-lived, self-contained admin manage tokens so no DB write is
 * needed — expiry, IP hash, and UA hash are claims inside the token itself.
 */

const encoder = new TextEncoder();

function b64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): string {
  return atob(input.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
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

export async function signAdminManageJwt(secret: string, claims: Omit<AdminManageClaims, "exp"> & { ttlSeconds: number }): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: claims.sub,
    event: claims.event,
    iphash: claims.iphash,
    uahash: claims.uahash,
    exp: Math.floor(Date.now() / 1000) + claims.ttlSeconds,
  }));
  const sig = await hmacSign(secret, `${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export type JwtVerifyResult =
  | { ok: true; claims: AdminManageClaims }
  | { ok: false; reason: "invalid" | "expired" };

export async function verifyAdminManageJwt(secret: string, token: string): Promise<JwtVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const [header, payload, sig] = parts;
  const valid = await hmacVerify(secret, `${header}.${payload}`, sig);
  if (!valid) return { ok: false, reason: "invalid" };

  let claims: AdminManageClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload)) as AdminManageClaims;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (Math.floor(Date.now() / 1000) > claims.exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims };
}
