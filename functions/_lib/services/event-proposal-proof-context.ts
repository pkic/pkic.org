import type { z } from "zod";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { parseCapabilityToken } from "../auth/capability-token";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { sha256Hex } from "../utils/crypto";
import { first } from "../db/queries";
import { prepareInvitedSpeakerAccountClaim } from "./event-proposal-proof-person";
import { issueDatabaseCapability } from "../auth/capability-links";
import { getSpeakerByManageToken } from "./proposals";
import type { ParticipantAuthority } from "./participant-authority";
import { activeEffectiveInviteExpirySql, effectiveProposalSpeakerInviteExpirySql } from "../invite-validity";
import { invitationMailboxEvidence, isInvitationMailbox } from "./proposal-speaker-account-authority";
import type {
  eventProposalProofContextSchema,
  EventProposalProofPayload,
  EventProposalContinuationPayload,
} from "./event-proposal-proof-capabilities";

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
  // Only a speaker confirms an address here; a proposer signs in.
  if (!authority)
    throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Open your speaker invitation to confirm an email.");
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

export async function prepareEventProposalProofContext(
  db: DatabaseLike,
  input: {
    payload: EventProposalProofPayload | EventProposalContinuationPayload;
    signingSecret: string;
    actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
    speakerAuthority?: ParticipantAuthority;
    speakerId?: string;
  },
): Promise<StatementLike[]> {
  const context = input.payload.context;
  if (input.speakerId !== context.speakerId || !input.speakerAuthority)
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
    ...("speakerClaimSessionId" in input.payload
      ? await prepareInvitedSpeakerAccountClaim(db, input.payload, input.actor)
      : []),
    ...(await prepareInvitationMailboxProof(db, input.payload)),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM proposal_speakers ps JOIN session_proposals sp ON sp.id=ps.proposal_id AND sp.deleted_at IS NULL JOIN events e ON e.id=sp.event_id WHERE ps.id=? AND ps.proposal_id=? AND ps.user_id=? AND ps.invite_generation=? AND ps.manage_link_secret IS ? AND sp.event_id=? AND (${capability ? "0" : "1"} OR ps.status NOT IN ('invited','pending') OR (${activeEffectiveInviteExpirySql(effectiveProposalSpeakerInviteExpirySql("ps", "e"), "strftime('%Y-%m-%dT%H:%M:%fZ','now')")})) AND ${capability ? "? > unixepoch('now')" : "EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=ps.user_id AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"}`,
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

/**
 * A mailbox proved by opening its speaker link holds only while that link's invitation was mailed to it and
 * the account is still unclaimed. Returns the guard that rechecks this in the caller's batch.
 */
async function prepareInvitationMailboxProof(
  db: DatabaseLike,
  payload: EventProposalProofPayload | EventProposalContinuationPayload,
): Promise<StatementLike[]> {
  if (payload.basis !== "invitation") return [];
  const context = payload.context;
  if (context.sessionId)
    throw new AppError(403, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Invalid speaker confirmation context.");
  const invitation = { speakerId: context.speakerId, userId: context.userId, email: payload.email };
  const evidence = invitationMailboxEvidence(invitation);
  if (!(await isInvitationMailbox(db, invitation)))
    throw new AppError(409, "PROPOSAL_PERSON_CHANGED", "Your account or invitation changed. Confirm your email again.");
  return [prepareAuthorizationGuard(db, evidence)];
}

/** A signed mailbox proof resumes only its original, still-live speaker authority. */
export async function resumeEventProposalSpeakerProof(
  db: DatabaseLike,
  input: { payload: EventProposalProofPayload & { expiresAt: number }; signingSecret: string },
): Promise<string> {
  const context = input.payload.context;
  if (context.sessionId)
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
  await prepareInvitationMailboxProof(db, input.payload);
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
