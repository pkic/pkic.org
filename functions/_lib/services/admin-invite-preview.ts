import { sha256Hex } from "../utils/crypto";
import { AppError } from "../errors";
import { signAdminPreviewToken, verifyAdminPreviewToken } from "../auth/admin-preview-token";

export type AdminInviteType = "attendee" | "speaker";

interface AdminInvitePreviewClaims {
  v: 1;
  type: "admin_invite_bulk";
  inviteType: AdminInviteType;
  eventId: string;
  adminId: string;
  inviteDigest: string;
  exp: number;
}

export interface AdminInvitePreviewInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  sourceType?: string | null;
}

export function computeAdminInviteDigest(invites: AdminInvitePreviewInput[], expiresAt: string): Promise<string> {
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

export async function signAdminInvitePreviewToken(payload: {
  secret: string;
  eventId: string;
  adminId: string;
  inviteType: AdminInviteType;
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

export type AdminInvitePreviewTokenValidation =
  { ok: true; claims: AdminInvitePreviewClaims } | { ok: false; reason: "invalid" | "expired" | "mismatch" };

export async function verifyAdminInvitePreviewToken(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  inviteType: AdminInviteType;
  inviteDigest: string;
}): Promise<AdminInvitePreviewTokenValidation> {
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

export async function requireValidAdminInvitePreview(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  inviteType: AdminInviteType;
  inviteDigest: string;
}): Promise<AdminInvitePreviewClaims> {
  const validation = await verifyAdminInvitePreviewToken(payload);
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
