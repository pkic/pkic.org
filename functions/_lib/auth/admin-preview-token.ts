import { hmacSha256Hex } from "../utils/crypto";

export type AdminPreviewTokenFailure = { ok: false; reason: "invalid" | "expired" | "mismatch" };

interface AdminPreviewClaims {
  v: 1;
  type: string;
  eventId: string;
  adminId: string;
  digest: string;
  exp: number;
  [key: string]: unknown;
}

function b64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function signAdminPreviewToken(payload: {
  secret: string;
  type: string;
  eventId: string;
  adminId: string;
  digest: string;
  ttlSeconds: number;
  extraClaims?: Record<string, unknown>;
}): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + payload.ttlSeconds;
  const claims: AdminPreviewClaims = {
    ...payload.extraClaims,
    v: 1,
    type: payload.type,
    eventId: payload.eventId,
    adminId: payload.adminId,
    digest: payload.digest,
    exp,
  };
  const encoded = b64urlEncode(JSON.stringify(claims));
  const signature = await hmacSha256Hex(payload.secret, encoded);
  return { token: `${encoded}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifyAdminPreviewToken(payload: {
  secret: string;
  token: string;
  type: string;
  eventId: string;
  adminId: string;
  digest: string;
  extraClaimsMatch?: (claims: AdminPreviewClaims) => boolean;
}): Promise<{ ok: true; claims: AdminPreviewClaims } | AdminPreviewTokenFailure> {
  const parts = payload.token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [encoded, signature] = parts;
  const expectedSignature = await hmacSha256Hex(payload.secret, encoded);
  if (!constantTimeEqual(signature, expectedSignature)) return { ok: false, reason: "invalid" };

  let claims: AdminPreviewClaims;
  try {
    claims = JSON.parse(b64urlDecode(encoded)) as AdminPreviewClaims;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    !claims ||
    claims.v !== 1 ||
    claims.type !== payload.type ||
    typeof claims.exp !== "number" ||
    typeof claims.eventId !== "string" ||
    typeof claims.adminId !== "string" ||
    typeof claims.digest !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (Math.floor(Date.now() / 1000) > claims.exp) return { ok: false, reason: "expired" };
  if (
    claims.eventId !== payload.eventId ||
    claims.adminId !== payload.adminId ||
    claims.digest !== payload.digest ||
    (payload.extraClaimsMatch && !payload.extraClaimsMatch(claims))
  ) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, claims };
}
