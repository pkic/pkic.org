import { z } from "zod";
import { memberJoinApplicantKindSchema } from "../../../../../assets/shared/schemas/member-join";
import { normalizedEmailSchema } from "../../../../../assets/shared/schemas/api-common";
import {
  queuedCapabilityToken,
  signStatelessCapabilityToken,
  verifyStatelessCapabilityToken,
} from "../../../auth/capability-links";
import { AppError } from "../../../errors";
import { randomToken } from "../../../utils/crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const memberJoinCapabilityPayloadSchema = z.object({
  email: normalizedEmailSchema,
  applicantKind: memberJoinApplicantKindSchema,
  capabilityId: z.string().min(16).max(64),
});
export type MemberJoinCapabilityPayload = z.infer<typeof memberJoinCapabilityPayloadSchema>;

function encodePayload(payload: MemberJoinCapabilityPayload): string {
  const bytes = encoder.encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodePayload(resourceId: string): MemberJoinCapabilityPayload | null {
  if (!/^[A-Za-z0-9_-]+$/.test(resourceId)) return null;
  try {
    const normalized = resourceId.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return memberJoinCapabilityPayloadSchema.parse(JSON.parse(decoder.decode(bytes)));
  } catch {
    return null;
  }
}

export function newMemberJoinCapabilityPayload(
  email: string,
  applicantKind: MemberJoinCapabilityPayload["applicantKind"],
): MemberJoinCapabilityPayload {
  return { email, applicantKind, capabilityId: randomToken(18) };
}

export function queuedMemberJoinVerificationToken(
  payload: MemberJoinCapabilityPayload,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  // Delivery materializes this server-authored marker with the Worker signing
  // secret. D1 stores neither a usable verification token nor its signing key.
  return queuedCapabilityToken(
    "member_join_verify",
    encodePayload(payload),
    ttlSeconds,
    undefined,
    nowSeconds + ttlSeconds,
  );
}

export async function verifyMemberJoinVerificationToken(
  signingSecret: string,
  token: string,
): Promise<MemberJoinCapabilityPayload> {
  const verified = await verifyStatelessCapabilityToken({
    signingSecret,
    purpose: "member_join_verify",
    token,
  });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "MEMBER_JOIN_LINK_EXPIRED" : "MEMBER_JOIN_LINK_INVALID",
      verified.reason === "expired" ? "Membership verification link expired" : "Invalid membership verification link",
    );
  }
  const payload = decodePayload(verified.resourceId);
  if (!payload) throw new AppError(404, "MEMBER_JOIN_LINK_INVALID", "Invalid membership verification link");
  return payload;
}

export function issueMemberJoinApplicationToken(
  signingSecret: string,
  payload: MemberJoinCapabilityPayload,
  ttlSeconds: number,
): Promise<string> {
  return signStatelessCapabilityToken({
    signingSecret,
    purpose: "member_join_apply",
    resourceId: encodePayload(payload),
    ttlSeconds,
  });
}

export async function verifyMemberJoinApplicationToken(
  signingSecret: string,
  token: string,
): Promise<MemberJoinCapabilityPayload> {
  const verified = await verifyStatelessCapabilityToken({
    signingSecret,
    purpose: "member_join_apply",
    token,
  });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 401,
      verified.reason === "expired" ? "MEMBER_JOIN_CAPABILITY_EXPIRED" : "MEMBER_JOIN_CAPABILITY_INVALID",
      verified.reason === "expired"
        ? "Membership application capability expired"
        : "Invalid membership application capability",
    );
  }
  const payload = decodePayload(verified.resourceId);
  if (!payload) throw new AppError(401, "MEMBER_JOIN_CAPABILITY_INVALID", "Invalid membership application capability");
  return payload;
}
