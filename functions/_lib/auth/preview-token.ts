import { constantTimeEqual, hmacSha256Hex } from "../utils/crypto";

export type PreviewTokenFailure = { ok: false; reason: "invalid" | "expired" | "mismatch" };

export interface PreviewTokenClaims {
  v: 1;
  type: string;
  eventId: string;
  actorId: string;
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

export async function signPreviewToken(payload: {
  secret: string;
  type: string;
  eventId: string;
  actorId: string;
  digest: string;
  ttlSeconds: number;
  extraClaims?: Record<string, unknown>;
}): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + payload.ttlSeconds;
  const claims: PreviewTokenClaims = {
    ...payload.extraClaims,
    v: 1,
    type: payload.type,
    eventId: payload.eventId,
    actorId: payload.actorId,
    digest: payload.digest,
    exp,
  };
  const encoded = b64urlEncode(JSON.stringify(claims));
  const signature = await hmacSha256Hex(payload.secret, encoded);
  return { token: `${encoded}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifyPreviewToken(payload: {
  secret: string;
  token: string;
  type: string;
  eventId: string;
  actorId: string;
  digest: string;
  extraClaimsMatch?: (claims: PreviewTokenClaims) => boolean;
}): Promise<{ ok: true; claims: PreviewTokenClaims } | PreviewTokenFailure> {
  const parts = payload.token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [encoded, signature] = parts;
  const expectedSignature = await hmacSha256Hex(payload.secret, encoded);
  if (!(await constantTimeEqual(signature, expectedSignature))) return { ok: false, reason: "invalid" };

  let claims: PreviewTokenClaims;
  try {
    claims = JSON.parse(b64urlDecode(encoded)) as PreviewTokenClaims;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    !claims ||
    claims.v !== 1 ||
    claims.type !== payload.type ||
    typeof claims.exp !== "number" ||
    typeof claims.eventId !== "string" ||
    typeof claims.actorId !== "string" ||
    typeof claims.digest !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (Math.floor(Date.now() / 1000) > claims.exp) return { ok: false, reason: "expired" };
  if (
    claims.eventId !== payload.eventId ||
    claims.actorId !== payload.actorId ||
    claims.digest !== payload.digest ||
    (payload.extraClaimsMatch && !payload.extraClaimsMatch(claims))
  ) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, claims };
}
