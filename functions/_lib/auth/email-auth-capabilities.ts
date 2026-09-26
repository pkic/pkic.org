import { z } from "zod";
import { normalizeEmail } from "../validation";
import { hmacSha256Hex, randomToken, verifyHmacSha256Hex } from "../utils/crypto";
import { AppError } from "../errors";
import {
  isAuthorizationGuardFailure,
  prepareAuthorizationGuard,
  type AuthorizationEvidence,
} from "../db/authorization-guard";
import { prepareOneTimeAuditLog, type AuditScope } from "../services/audit";
import type { DatabaseLike, StatementLike } from "../types";
import {
  queuedCapabilityToken,
  verifyStatelessCapabilityToken,
  type EmailAuthCapabilityPurpose,
} from "./capability-links";
import { decodeCapabilityPayload, encodeCapabilityPayload } from "./capability-payload";

const EMAIL_FINGERPRINT_DOMAIN = "pkic-email-auth-address:v1";
const DEFAULT_MAX_RETURN_TO_LENGTH = 2048;

const emailAuthCapabilityPayloadSchema = z
  .object({
    subjectId: z.string().min(1).max(128),
    capabilityId: z.string().min(16).max(64),
    emailFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    ipHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    userAgentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    returnTo: z.string().min(1).max(DEFAULT_MAX_RETURN_TO_LENGTH).optional(),
  })
  .strict();

export type EmailAuthCapabilityPayload = z.infer<typeof emailAuthCapabilityPayloadSchema>;

export interface VerifiedEmailAuthCapability extends EmailAuthCapabilityPayload {
  expiresAt: number;
}

function emailFingerprintInput(email: string): string {
  return `${EMAIL_FINGERPRINT_DOMAIN}\0${normalizeEmail(email)}`;
}

export async function queueEmailAuthCapability(options: {
  signingSecret: string;
  purpose: EmailAuthCapabilityPurpose;
  subjectId: string;
  email: string;
  ttlSeconds: number;
  ipHash?: string | null;
  userAgentHash?: string | null;
  returnTo?: string;
  nowSeconds?: number;
}): Promise<{ capabilityId: string; queuedToken: string }> {
  const capabilityId = randomToken(18);
  const payload = emailAuthCapabilityPayloadSchema.parse({
    subjectId: options.subjectId,
    capabilityId,
    emailFingerprint: await hmacSha256Hex(options.signingSecret, emailFingerprintInput(options.email)),
    ipHash: options.ipHash ?? null,
    userAgentHash: options.userAgentHash ?? null,
    ...(options.returnTo ? { returnTo: options.returnTo } : {}),
  });
  const nowSeconds = Math.floor(options.nowSeconds ?? Date.now() / 1000);
  const ttlSeconds = Math.max(1, Math.floor(options.ttlSeconds));
  return {
    capabilityId,
    queuedToken: queuedCapabilityToken(
      options.purpose,
      encodeCapabilityPayload(payload),
      ttlSeconds,
      undefined,
      nowSeconds + ttlSeconds,
    ),
  };
}

export async function verifyEmailAuthCapabilityToken(options: {
  signingSecret: string;
  purpose: EmailAuthCapabilityPurpose;
  token: string;
  ipHash?: string | null;
  userAgentHash?: string | null;
}): Promise<VerifiedEmailAuthCapability> {
  const verified = await verifyStatelessCapabilityToken({
    signingSecret: options.signingSecret,
    purpose: options.purpose,
    token: options.token,
  });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "MAGIC_LINK_EXPIRED" : "MAGIC_LINK_INVALID",
      verified.reason === "expired" ? "Magic link expired" : "Invalid magic link token",
    );
  }

  const payload = decodeCapabilityPayload(verified.resourceId, emailAuthCapabilityPayloadSchema);
  if (!payload) throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid magic link token");
  if (payload.ipHash && payload.ipHash !== (options.ipHash ?? null)) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this network");
  }
  if (payload.userAgentHash && payload.userAgentHash !== (options.userAgentHash ?? null)) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this browser");
  }
  return { ...payload, expiresAt: verified.expiresAt };
}

export async function assertEmailAuthCapabilityEmail(options: {
  signingSecret: string;
  capability: Pick<EmailAuthCapabilityPayload, "emailFingerprint">;
  currentEmail: string;
}): Promise<void> {
  if (!(await emailAuthCapabilityMatchesEmail(options))) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid magic link token");
  }
}

export async function emailAuthCapabilityMatchesEmail(options: {
  signingSecret: string;
  capability: Pick<EmailAuthCapabilityPayload, "emailFingerprint">;
  currentEmail: string;
}): Promise<boolean> {
  return verifyHmacSha256Hex(
    options.signingSecret,
    emailFingerprintInput(options.currentEmail),
    options.capability.emailFingerprint,
  );
}

export function emailAuthRedemptionKey(purpose: EmailAuthCapabilityPurpose, capabilityId: string): string {
  return `email_auth_redeemed:${purpose}:${capabilityId}`;
}

function isEmailAuthReplayConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("uq_audit_log_idempotency_key") || error.message.includes("audit_log.idempotency_key"))
  );
}

function emailAuthReplayError(): AppError {
  return new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
}

export async function commitEmailAuthRedemption(
  db: DatabaseLike,
  options: {
    purpose: EmailAuthCapabilityPurpose;
    capabilityId: string;
    actorType: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    details: unknown;
    createdAt: string;
    scope?: AuditScope | null;
    authorizationEvidence: AuthorizationEvidence | readonly AuthorizationEvidence[];
    statements: StatementLike[];
  },
): Promise<void> {
  const authorizationEvidence = Array.isArray(options.authorizationEvidence)
    ? options.authorizationEvidence
    : [options.authorizationEvidence];
  try {
    await db.batch([
      ...authorizationEvidence.map((evidence) => prepareAuthorizationGuard(db, evidence)),
      prepareOneTimeAuditLog(
        db,
        options.actorType,
        options.actorId,
        options.action,
        options.entityType,
        options.entityId,
        options.details,
        options.createdAt,
        emailAuthRedemptionKey(options.purpose, options.capabilityId),
        options.scope ?? null,
      ),
      ...options.statements,
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid magic link token");
    }
    if (isEmailAuthReplayConflict(error)) throw emailAuthReplayError();
    throw error;
  }
}
