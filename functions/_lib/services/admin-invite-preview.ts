import { hmacSha256Hex, sha256Hex } from "../utils/crypto";

interface AttendeeInvitePreviewClaims {
  v: 1;
  type: "attendee_invite_bulk";
  eventId: string;
  adminId: string;
  inviteDigest: string;
  exp: number;
}

interface AttendeeInvitePreviewInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  sourceType?: string | null;
}

export function computeAttendeeInviteDigest(invites: AttendeeInvitePreviewInput[]): Promise<string> {
  const canonical = invites.map((item) => ({
    email: item.email.trim().toLowerCase(),
    firstName: (item.firstName ?? "").trim(),
    lastName: (item.lastName ?? "").trim(),
    sourceType: (item.sourceType ?? "").trim(),
  }));

  return sha256Hex(JSON.stringify(canonical));
}

function b64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signAttendeeInvitePreviewToken(payload: {
  secret: string;
  eventId: string;
  adminId: string;
  inviteDigest: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + payload.ttlSeconds;
  const claims: AttendeeInvitePreviewClaims = {
    v: 1,
    type: "attendee_invite_bulk",
    eventId: payload.eventId,
    adminId: payload.adminId,
    inviteDigest: payload.inviteDigest,
    exp,
  };

  const encoded = b64urlEncode(JSON.stringify(claims));
  const signature = await hmacSha256Hex(payload.secret, encoded);
  return {
    token: `${encoded}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type AttendeeInvitePreviewTokenValidation =
  | { ok: true; claims: AttendeeInvitePreviewClaims }
  | { ok: false; reason: "invalid" | "expired" | "mismatch" };

export async function verifyAttendeeInvitePreviewToken(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  inviteDigest: string;
}): Promise<AttendeeInvitePreviewTokenValidation> {
  const parts = payload.token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };

  const [encoded, signature] = parts;
  const expectedSignature = await hmacSha256Hex(payload.secret, encoded);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, reason: "invalid" };
  }

  let claims: AttendeeInvitePreviewClaims;
  try {
    claims = JSON.parse(b64urlDecode(encoded)) as AttendeeInvitePreviewClaims;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (claims.v !== 1 || claims.type !== "attendee_invite_bulk") {
    return { ok: false, reason: "invalid" };
  }

  if (Math.floor(Date.now() / 1000) > claims.exp) {
    return { ok: false, reason: "expired" };
  }

  if (
    claims.eventId !== payload.eventId
    || claims.adminId !== payload.adminId
    || claims.inviteDigest !== payload.inviteDigest
  ) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true, claims };
}
