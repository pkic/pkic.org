import type { z } from "zod";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { parseCapabilityToken } from "../auth/capability-token";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { sha256Hex } from "../utils/crypto";
import { first } from "../db/queries";
import { prepareCurrentEventProposalProof } from "./event-proposal-proof-current";
import { resolveProposalProofPerson } from "./event-proposal-proof-person";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";
import { issueDatabaseCapability } from "../auth/capability-links";
import { getSpeakerByManageToken } from "./proposals";
import type { ParticipantAuthority } from "./participant-authority";
import { activeEffectiveInviteExpirySql, effectiveProposalSpeakerInviteExpirySql } from "../invite-validity";
import type { eventProposalProofContextSchema, EventProposalProofPayload } from "./event-proposal-proof-capabilities";

/** The proposal resource identifies only its authenticated speaker owner, never another roster member. */
export function eventProposalSpeakerAuthority(input: {
  actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
  speakerManagementToken?: string;
  speakerProposalId?: string;
}): ParticipantAuthority | undefined {
  if (input.speakerManagementToken && input.speakerProposalId)
    throw new AppError(422, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Choose one speaker authority.");
  if (!input.speakerProposalId) return input.speakerManagementToken;
  if (!input.actor) throw new AppError(401, "AUTH_REQUIRED", "Sign in to manage your speaker participation.");
  return { resourceId: input.speakerProposalId, ...input.actor };
}

export async function createEventProposalProofContext(
  db: DatabaseLike,
  input: {
    eventId: string;
    signingSecret: string;
    actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
    speakerManagementToken?: string;
    speakerProposalId?: string;
  },
): Promise<EventProposalProofContext> {
  const authority = eventProposalSpeakerAuthority(input);
  if (authority) {
    const { speaker, proposal } = await getSpeakerByManageToken(db, authority, input.signingSecret);
    const session =
      typeof authority === "string"
        ? null
        : await first<{ expires_at: string }>(
            db,
            "SELECT expires_at FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [authority.sessionId ?? "", authority.userId],
          );
    if (typeof authority !== "string" && !session)
      throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Your speaker session has ended.");
    if (proposal.event_id !== input.eventId || (input.actor && input.actor.userId !== speaker.user_id))
      throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Use your own speaker invitation.");
    return {
      kind: "speaker" as const,
      userId: speaker.user_id,
      speakerId: speaker.id,
      inviteGeneration: speaker.invite_generation,
      secretDigest: await sha256Hex(speaker.manage_link_secret ?? ""),
      expiresAt:
        typeof authority === "string"
          ? parseCapabilityToken(authority, "speaker_manage")!.expiresAt
          : Math.floor(Date.parse(session!.expires_at) / 1000),
      ...(typeof authority !== "string" ? { sessionId: authority.sessionId } : {}),
    };
  }
  return input.actor
    ? { kind: "session" as const, userId: input.actor.userId, sessionId: input.actor.sessionId }
    : null;
}

export async function prepareEventProposalProofContext(
  db: DatabaseLike,
  input: {
    payload: EventProposalProofPayload;
    signingSecret: string;
    actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
    speakerAuthority?: ParticipantAuthority;
    speakerId?: string;
    operation: EventProposalProofPayload["operation"];
  },
): Promise<StatementLike[]> {
  const context = input.payload.context;
  if (input.payload.operation !== input.operation)
    throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "This confirmation belongs to a different action.");
  if (!context) {
    if (input.operation !== "proposal_submission")
      throw new AppError(
        403,
        "PROPOSAL_PROOF_CONTEXT_MISMATCH",
        "A speaker confirmation must identify its invited person.",
      );
    return [];
  }
  if (context.kind === "mailbox") {
    if (
      input.operation !== "proposal_submission" ||
      (input.actor && input.actor.userId !== context.userId) ||
      (context.sessionId && (!input.actor || input.actor.sessionId !== context.sessionId))
    )
      throw new AppError(
        403,
        "PROPOSAL_PROOF_CONTEXT_MISMATCH",
        "Continue with the person who confirmed the original mailbox.",
      );
    const resolved = await resolveProposalProofPerson(db, context.email);
    if (!resolved?.user || resolved.user.id !== context.userId || resolved.emailId !== context.emailId)
      throw new AppError(409, "PROPOSAL_PERSON_CHANGED", "The original confirmed mailbox's account changed.");
    return [
      ...(await prepareCurrentEventProposalProof(db, {
        ...input.payload,
        capabilityId: context.capabilityId,
        termsDigest: context.termsDigest,
        expiresAt: context.expiresAt,
      })),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
        bindings: [context.userId],
      }),
      prepareAuthorizationGuard(
        db,
        ownedIdentityEmailEvidence({
          userId: context.userId,
          emailId: context.emailId,
          normalizedEmail: context.email,
        }),
      ),
      ...(context.sessionId
        ? [
            prepareAuthorizationGuard(db, {
              sql: "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
              bindings: [context.sessionId, context.userId],
            }),
          ]
        : []),
    ];
  }
  if (context.kind === "session") {
    if (input.operation !== "proposal_submission")
      throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "This confirmation does not identify a speaker.");
    if (!input.actor || input.actor.userId !== context.userId || input.actor.sessionId !== context.sessionId)
      throw new AppError(
        403,
        "PROPOSAL_PROOF_CONTEXT_MISMATCH",
        "Continue with the account that requested this confirmation.",
      );
    return [
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        bindings: [context.sessionId, context.userId],
      }),
    ];
  }
  if (input.operation !== "speaker_profile" || input.speakerId !== context.speakerId || !input.speakerAuthority)
    throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Continue with the same speaker invitation.");
  if (
    context.sessionId &&
    (!input.actor ||
      input.actor.userId !== context.userId ||
      input.actor.sessionId !== context.sessionId ||
      typeof input.speakerAuthority === "string" ||
      input.speakerAuthority.sessionId !== context.sessionId ||
      input.speakerAuthority.userId !== context.userId)
  )
    throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Continue with the same signed-in speaker session.");
  const { speaker, proposal } = await getSpeakerByManageToken(db, input.speakerAuthority, input.signingSecret);
  if (
    proposal.event_id !== input.payload.eventId ||
    speaker.id !== context.speakerId ||
    speaker.user_id !== context.userId ||
    speaker.invite_generation !== context.inviteGeneration ||
    (await sha256Hex(speaker.manage_link_secret ?? "")) !== context.secretDigest
  )
    throw new AppError(
      403,
      "PROPOSAL_PROOF_CONTEXT_MISMATCH",
      "The speaker invitation changed. Confirm the email again.",
    );
  const capability =
    typeof input.speakerAuthority === "string" ? parseCapabilityToken(input.speakerAuthority, "speaker_manage") : null;
  return [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM proposal_speakers ps JOIN session_proposals sp ON sp.id=ps.proposal_id AND sp.deleted_at IS NULL JOIN events e ON e.id=sp.event_id WHERE ps.id=? AND ps.proposal_id=? AND ps.user_id=? AND ps.invite_generation=? AND ps.manage_link_secret IS ? AND sp.event_id=? AND (ps.status NOT IN ('invited','pending') OR (${activeEffectiveInviteExpirySql(effectiveProposalSpeakerInviteExpirySql("ps", "e"), "strftime('%Y-%m-%dT%H:%M:%fZ','now')")})) AND ${capability ? "? > unixepoch('now')" : "EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=ps.user_id AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"}`,
      bindings: [
        speaker.id,
        proposal.id,
        speaker.user_id,
        speaker.invite_generation,
        speaker.manage_link_secret,
        input.payload.eventId,
        capability
          ? capability.expiresAt
          : typeof input.speakerAuthority === "string"
            ? ""
            : (input.speakerAuthority.sessionId ?? ""),
      ],
    }),
  ];
}

export type EventProposalProofContext = z.infer<typeof eventProposalProofContextSchema>;

/** A signed mailbox proof resumes only its original, still-live speaker authority. */
export async function resumeEventProposalSpeakerProof(
  db: DatabaseLike,
  input: { payload: EventProposalProofPayload & { expiresAt: number }; signingSecret: string },
): Promise<string> {
  const context = input.payload.context;
  if (input.payload.operation !== "speaker_profile" || context?.kind !== "speaker" || context.sessionId)
    throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Invalid speaker confirmation context.");
  const row = await first<{ manage_link_secret: string }>(
    db,
    `SELECT ps.manage_link_secret FROM proposal_speakers ps JOIN session_proposals sp ON sp.id=ps.proposal_id AND sp.deleted_at IS NULL JOIN events e ON e.id=sp.event_id WHERE ps.id=? AND ps.user_id=? AND ps.invite_generation=? AND sp.event_id=? AND ? > unixepoch('now') AND (ps.status NOT IN ('invited','pending') OR (${activeEffectiveInviteExpirySql(effectiveProposalSpeakerInviteExpirySql("ps", "e"), "strftime('%Y-%m-%dT%H:%M:%fZ','now')")}))`,
    [context.speakerId, context.userId, context.inviteGeneration, input.payload.eventId, context.expiresAt],
  );
  if (!row || (await sha256Hex(row.manage_link_secret)) !== context.secretDigest)
    throw new AppError(
      403,
      "PROPOSAL_PROOF_CONTEXT_MISMATCH",
      "The speaker invitation changed. Confirm your email again.",
    );
  return issueDatabaseCapability({
    db,
    signingSecret: input.signingSecret,
    purpose: "speaker_manage",
    resourceId: context.speakerId,
    expectedLinkSecretFingerprint: context.secretDigest,
    ttlSeconds: Math.min(
      15 * 60,
      context.expiresAt - Math.floor(Date.now() / 1000),
      input.payload.expiresAt - Math.floor(Date.now() / 1000),
    ),
  });
}
