import { z } from "zod";
import { normalizedEmailSchema } from "../../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../../assets/shared/schemas/identifiers";
import { memberJoinApplicantKindSchema } from "../../../assets/shared/schemas/member-join";
import { decodeCapabilityPayload, encodeCapabilityPayload } from "../auth/capability-payload";
import {
  queuedCapabilityToken,
  signStatelessCapabilityToken,
  verifyStatelessCapabilityToken,
} from "../auth/capability-links";
import { AppError } from "../errors";
import { sha256Hex } from "../utils/crypto";
import type { EventTermRecord } from "./events";
import { proposalEntryContextSchema } from "../../../assets/shared/schemas/proposal-entry";

export const eventProposalEntryReceiptSchema = proposalEntryContextSchema
  .omit({ inviteToken: true, inviteId: true })
  .extend({
    invite: z
      .object({
        id: databaseIdSchema,
        secretDigest: z.string().regex(/^[a-f0-9]{64}$/),
        expiresAt: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EventProposalEntryReceipt = z.infer<typeof eventProposalEntryReceiptSchema>;

export const eventProposalProofContextSchema = z
  .union([
    z.object({ kind: z.literal("session"), userId: databaseIdSchema, sessionId: databaseIdSchema }).strict(),
    z
      .object({
        kind: z.literal("mailbox"),
        userId: databaseIdSchema,
        email: normalizedEmailSchema,
        emailId: databaseIdSchema.nullable(),
        capabilityId: z.string().min(16).max(64),
        termsDigest: z.string().regex(/^[a-f0-9]{64}$/),
        expiresAt: z.number().int().positive(),
        sessionId: databaseIdSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("speaker"),
        userId: databaseIdSchema,
        speakerId: databaseIdSchema,
        sessionId: databaseIdSchema.optional(),
        inviteGeneration: z.number().int().nonnegative(),
        secretDigest: z.string().regex(/^[a-f0-9]{64}$/),
        expiresAt: z.number().int().positive(),
      })
      .strict(),
  ])
  .nullable();
const proofPayloadSchema = z
  .object({
    eventId: databaseIdSchema,
    email: normalizedEmailSchema,
    applicantKind: memberJoinApplicantKindSchema,
    capabilityId: z.string().min(16).max(64),
    termsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.enum(["proposal_submission", "speaker_profile"]),
    context: eventProposalProofContextSchema,
    entryContext: eventProposalEntryReceiptSchema.optional(),
  })
  .strict();
const continuationPayloadSchema = proofPayloadSchema.extend({ userId: databaseIdSchema.nullable() });
export type EventProposalProofPayload = z.infer<typeof proofPayloadSchema>;
export type EventProposalContinuationPayload = z.infer<typeof continuationPayloadSchema>;
export const eventProposalProofRedemptionKey = (id: string) => `event_proposal_proof_consumed:${id}`;

export function proposalTermsDigest(terms: readonly EventTermRecord[]): Promise<string> {
  return sha256Hex(
    JSON.stringify(
      terms
        .map((term) => ({
          key: term.term_key,
          version: term.version,
          required: term.required,
          content: term.content_ref,
          display: term.display_text,
          help: term.help_text,
        }))
        .sort((a, b) => a.key.localeCompare(b.key) || a.version.localeCompare(b.version)),
    ),
  );
}

export function queuedEventProposalProofToken(payload: EventProposalProofPayload, ttlSeconds: number): string {
  return queuedCapabilityToken(
    "event_proposal_verify",
    encodeCapabilityPayload(payload),
    ttlSeconds,
    undefined,
    Math.floor(Date.now() / 1000) + ttlSeconds,
  );
}

export function issueEventProposalContinuation(
  signingSecret: string,
  payload: EventProposalContinuationPayload,
  expiresAt: number,
): Promise<string> {
  return signStatelessCapabilityToken({
    signingSecret,
    purpose: "event_proposal_continue",
    resourceId: encodeCapabilityPayload(payload),
    ttlSeconds: Math.max(1, expiresAt - Math.floor(Date.now() / 1000)),
  });
}

export async function verifyEventProposalCapability(
  signingSecret: string,
  token: string,
  eventId: string,
  continuation: true,
): Promise<EventProposalContinuationPayload & { expiresAt: number }>;
export async function verifyEventProposalCapability(
  signingSecret: string,
  token: string,
  eventId: string,
  continuation: false,
): Promise<EventProposalProofPayload & { expiresAt: number }>;
export async function verifyEventProposalCapability(
  signingSecret: string,
  token: string,
  eventId: string,
  continuation: boolean,
): Promise<(EventProposalProofPayload | EventProposalContinuationPayload) & { expiresAt: number }> {
  const verified = await verifyStatelessCapabilityToken({
    signingSecret,
    purpose: continuation ? "event_proposal_continue" : "event_proposal_verify",
    token,
  });
  if (!verified.ok)
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      "PROPOSAL_PROOF_INVALID",
      "The proposal email confirmation is invalid or expired.",
    );
  const payload = continuation
    ? decodeCapabilityPayload(verified.resourceId, continuationPayloadSchema)
    : decodeCapabilityPayload(verified.resourceId, proofPayloadSchema);
  if (!payload || payload.eventId !== eventId)
    throw new AppError(404, "PROPOSAL_PROOF_INVALID", "Invalid proposal email confirmation.");
  return { ...payload, expiresAt: verified.expiresAt };
}
