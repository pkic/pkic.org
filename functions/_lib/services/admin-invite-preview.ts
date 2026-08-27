import { sha256Hex } from "../utils/crypto";
import { AppError } from "../errors";
import { signAdminPreviewToken, verifyAdminPreviewToken } from "../auth/admin-preview-token";

export type EventInviteType = "attendee" | "speaker";

interface EventInvitePreviewClaims {
  v: 1;
  type: "admin_invite_bulk";
  inviteType: EventInviteType;
  eventId: string;
  adminId: string;
  inviteDigest: string;
  exp: number;
}

export interface EventInvitePreviewInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  sourceType?: string | null;
}

export function computeEventInviteDigest(invites: EventInvitePreviewInput[], expiresAt: string): Promise<string> {
  const canonical = {
    expiresAt,
    invites: invites.map((item) => ({
      email: item.email.trim().toLowerCase(),
      firstName: (item.firstName ?? "").trim(),
      lastName: (item.lastName ?? "").trim(),
      sourceType: (item.sourceType ?? "").trim(),
    })),
  };

  return sha256Hex(JSON.stringify(canonical));
}

export async function signEventInvitePreviewToken(payload: {
  secret: string;
  eventId: string;
  adminId: string;
  inviteType: EventInviteType;
  inviteDigest: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: string }> {
  return signAdminPreviewToken({
    ...payload,
    type: "admin_invite_bulk",
    digest: payload.inviteDigest,
    extraClaims: { inviteType: payload.inviteType },
  });
}

export type EventInvitePreviewTokenValidation =
  { ok: true; claims: EventInvitePreviewClaims } | { ok: false; reason: "invalid" | "expired" | "mismatch" };

export async function verifyEventInvitePreviewToken(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  inviteType: EventInviteType;
  inviteDigest: string;
}): Promise<EventInvitePreviewTokenValidation> {
  const validation = await verifyAdminPreviewToken({
    ...payload,
    type: "admin_invite_bulk",
    digest: payload.inviteDigest,
    extraClaimsMatch: (claims) => claims.inviteType === payload.inviteType,
  });
  if (!validation.ok) return validation;
  return {
    ok: true,
    claims: {
      v: 1,
      type: "admin_invite_bulk",
      inviteType: payload.inviteType,
      eventId: payload.eventId,
      adminId: payload.adminId,
      inviteDigest: payload.inviteDigest,
      exp: validation.claims.exp,
    },
  };
}

export async function requireValidEventInvitePreview(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  inviteType: EventInviteType;
  inviteDigest: string;
}): Promise<EventInvitePreviewClaims> {
  const validation = await verifyEventInvitePreviewToken(payload);
  if (validation.ok) return validation.claims;
  if (validation.reason === "expired") {
    throw new AppError(409, "INVITE_PREVIEW_EXPIRED", "Invite preview expired. Render a fresh preview before sending.");
  }
  if (validation.reason === "mismatch") {
    throw new AppError(
      409,
      "INVITE_PREVIEW_STALE",
      "Invite list changed after preview. Render preview again before sending.",
    );
  }
  throw new AppError(400, "INVITE_PREVIEW_INVALID", "Invalid invite preview token. Render preview before sending.");
}

/** Verifies that the submitted recipient batch is exactly the batch the user previewed. */
export async function requireValidEventInviteRecipientBatch(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  inviteType: EventInviteType;
  invites: EventInvitePreviewInput[];
  expiresAt: string;
  inviteDigest: string;
}): Promise<EventInvitePreviewClaims> {
  const computedDigest = await computeEventInviteDigest(payload.invites, payload.expiresAt);
  if (computedDigest !== payload.inviteDigest) {
    throw new AppError(
      409,
      "INVITE_PREVIEW_STALE",
      "Invite list changed after preview. Render preview again before sending.",
    );
  }
  return requireValidEventInvitePreview({
    secret: payload.secret,
    token: payload.token,
    eventId: payload.eventId,
    adminId: payload.adminId,
    inviteType: payload.inviteType,
    inviteDigest: computedDigest,
  });
}

/** @deprecated Import the domain-neutral event-invite helper instead. */
export type AdminInviteType = EventInviteType;
/** @deprecated Import the domain-neutral event-invite helper instead. */
export type AdminInvitePreviewInput = EventInvitePreviewInput;
/** @deprecated Import the domain-neutral event-invite helper instead. */
export type AdminInvitePreviewTokenValidation = EventInvitePreviewTokenValidation;
/** @deprecated Import the domain-neutral event-invite helper instead. */
export const computeAdminInviteDigest = computeEventInviteDigest;
/** @deprecated Import the domain-neutral event-invite helper instead. */
export const signAdminInvitePreviewToken = signEventInvitePreviewToken;
/** @deprecated Import the domain-neutral event-invite helper instead. */
export const verifyAdminInvitePreviewToken = verifyEventInvitePreviewToken;
/** @deprecated Import the domain-neutral event-invite helper instead. */
export const requireValidAdminInvitePreview = requireValidEventInvitePreview;
