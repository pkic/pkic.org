import {
  EMAIL_AUTH_RESOURCE_ID_MAX_LENGTH,
  EMAIL_AUTH_TOKEN_MAX_LENGTH,
} from "../../../assets/shared/constants/email-auth";
import { randomToken } from "../utils/crypto";
import { base64UrlToBytes, bytesToBase64Url } from "./capability-payload";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const CAPABILITY_TOKEN_PREFIX = "pkc1_";
export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
const SIGNING_DOMAIN = "pkic-public-capability:v1";

export type EmailAuthCapabilityPurpose = "user_sign_in" | "sponsor_sign_in" | "mcp_oauth_sign_in";

export type CapabilityPurpose =
  | "registration_manage"
  | "registration_confirm"
  | "invite"
  | "proposal_manage"
  | "speaker_manage"
  | "meeting_guest_verify"
  | "member_join_verify"
  | "member_join_apply"
  | EmailAuthCapabilityPurpose;

export type StatelessCapabilityPurpose = "member_join_verify" | "member_join_apply" | EmailAuthCapabilityPurpose;

export type CapabilityVerifyResult =
  { ok: true; resourceId: string; expiresAt: number } | { ok: false; reason: "invalid" | "expired" };

interface ParsedCapabilityToken {
  purpose: CapabilityPurpose;
  resourceId: string;
  expiresAt: number;
  encodedPayload: string;
  signature: string;
}

const purposeCodes: Record<CapabilityPurpose, string> = {
  registration_manage: "rm",
  registration_confirm: "rc",
  invite: "iv",
  proposal_manage: "pm",
  speaker_manage: "sm",
  meeting_guest_verify: "mgv",
  member_join_verify: "mjv",
  member_join_apply: "mja",
  user_sign_in: "usi",
  sponsor_sign_in: "ssi",
  mcp_oauth_sign_in: "moi",
};

const purposesByCode = Object.fromEntries(
  Object.entries(purposeCodes).map(([purpose, code]) => [code, purpose]),
) as Record<string, CapabilityPurpose>;

export function capabilityPurposeCode(purpose: CapabilityPurpose): string {
  return purposeCodes[purpose];
}

export function capabilityPurposeFromCode(code: string): CapabilityPurpose | undefined {
  return purposesByCode[code];
}

export function encodeCapabilityText(input: string): string {
  return bytesToBase64Url(encoder.encode(input));
}

export function decodeCapabilityText(input: string): string {
  return decoder.decode(base64UrlToBytes(input));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function signatureInput(purpose: CapabilityPurpose, encodedPayload: string, linkSecret: string): ArrayBuffer {
  return encoder.encode(`${SIGNING_DOMAIN}\0${purpose}\0${encodedPayload}\0${linkSecret}`).buffer as ArrayBuffer;
}

export function parseCapabilityToken(token: string, expectedPurpose: CapabilityPurpose): ParsedCapabilityToken | null {
  if (!token.startsWith(CAPABILITY_TOKEN_PREFIX) || token.length > EMAIL_AUTH_TOKEN_MAX_LENGTH) return null;
  const parts = token.slice(CAPABILITY_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  try {
    const values = decodeCapabilityText(encodedPayload).split("|");
    if (values.length !== 3) return null;
    const [purposeCode, resourceId, expiresAtRaw] = values;
    const purpose = capabilityPurposeFromCode(purposeCode);
    const expiresAt = Number(expiresAtRaw);
    if (
      purpose !== expectedPurpose ||
      !resourceId ||
      resourceId.length > EMAIL_AUTH_RESOURCE_ID_MAX_LENGTH ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= 0
    ) {
      return null;
    }
    return { purpose, resourceId, expiresAt, encodedPayload, signature };
  } catch {
    return null;
  }
}

export function newCapabilityLinkSecret(): string {
  return randomToken(32);
}

export async function signCapabilityToken(payload: {
  signingSecret: string;
  linkSecret: string;
  purpose: CapabilityPurpose;
  resourceId: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): Promise<string> {
  const ttlSeconds = Math.max(1, Math.floor(payload.ttlSeconds ?? DEFAULT_TTL_SECONDS));
  const expiresAt = Math.floor(payload.nowSeconds ?? Date.now() / 1000) + ttlSeconds;
  const encodedPayload = encodeCapabilityText(
    `${capabilityPurposeCode(payload.purpose)}|${payload.resourceId}|${expiresAt}`,
  );
  const key = await importHmacKey(payload.signingSecret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    signatureInput(payload.purpose, encodedPayload, payload.linkSecret),
  );
  return `${CAPABILITY_TOKEN_PREFIX}${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyCapabilityToken(payload: {
  signingSecret: string;
  linkSecret: string;
  purpose: CapabilityPurpose;
  token: string;
  nowSeconds?: number;
}): Promise<CapabilityVerifyResult> {
  const parsed = parseCapabilityToken(payload.token, payload.purpose);
  if (!parsed) return { ok: false, reason: "invalid" };
  if (Math.floor(payload.nowSeconds ?? Date.now() / 1000) >= parsed.expiresAt) {
    return { ok: false, reason: "expired" };
  }

  try {
    const signature = base64UrlToBytes(parsed.signature);
    const key = await importHmacKey(payload.signingSecret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature.buffer as ArrayBuffer,
      signatureInput(parsed.purpose, parsed.encodedPayload, payload.linkSecret),
    );
    return valid
      ? { ok: true, resourceId: parsed.resourceId, expiresAt: parsed.expiresAt }
      : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function isStatelessCapabilityPurpose(purpose: CapabilityPurpose): purpose is StatelessCapabilityPurpose {
  return (
    purpose === "member_join_verify" ||
    purpose === "member_join_apply" ||
    purpose === "user_sign_in" ||
    purpose === "sponsor_sign_in" ||
    purpose === "mcp_oauth_sign_in"
  );
}

export function statelessCapabilityLinkSecret(purpose: StatelessCapabilityPurpose): string {
  return `pkic-stateless-capability:${purpose}`;
}

export function signStatelessCapabilityToken(payload: {
  signingSecret: string;
  purpose: StatelessCapabilityPurpose;
  resourceId: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): Promise<string> {
  return signCapabilityToken({
    ...payload,
    linkSecret: statelessCapabilityLinkSecret(payload.purpose),
  });
}

export function verifyStatelessCapabilityToken(payload: {
  signingSecret: string;
  purpose: StatelessCapabilityPurpose;
  token: string;
}): Promise<CapabilityVerifyResult> {
  return verifyCapabilityToken({
    ...payload,
    linkSecret: statelessCapabilityLinkSecret(payload.purpose),
  });
}
