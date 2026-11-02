/**
 * A speaker link speaks for one proposal's participation, not for the person
 * who holds the account. The person's own name and headshot are shown on every
 * proposal, badge and agenda, so a link alone changes them only while nobody
 * has ever proved the account's mailbox: an account only an invitation made.
 * Once the mailbox is proved, the change needs that person's live session or
 * the mailbox proof they just completed on this speaker link.
 */
import { resolveOptionalIdentityFromRequest, type AuthenticatedIdentity } from "../auth/user-session";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, Env } from "../types";
import type { ParticipantAuthority } from "./participant-authority";
import { eventProposalProofRedemptionKey, verifyEventProposalCapability } from "./event-proposal-proof-capabilities";

/** The account has no proved mailbox: no verified primary address and no verified secondary one. */
export function unclaimedAccountSql(person: string): string {
  return `(${person}.email_verified_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM user_emails claimed WHERE claimed.user_id = ${person}.id AND claimed.verified_at IS NOT NULL))`;
}

/**
 * The speaker link was mailed to `email`, which is still an address of the
 * unclaimed account the invitation is for. Opening the link then proved that
 * mailbox. Read when the proof starts and rechecked in every batch that relies on it.
 */
export function invitationMailboxEvidence(input: {
  speakerId: string;
  userId: string;
  email: string;
}): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM proposal_speakers invitation
      JOIN users person ON person.id = invitation.user_id
      WHERE invitation.id = ? AND invitation.user_id = ? AND invitation.invited_email = ?
        AND ${unclaimedAccountSql("person")}
        AND (person.normalized_email = invitation.invited_email OR EXISTS (SELECT 1 FROM user_emails alias
          WHERE alias.user_id = person.id AND alias.normalized_email = invitation.invited_email))`,
    bindings: [input.speakerId, input.userId, input.email],
  };
}

export async function isInvitationMailbox(
  db: DatabaseLike,
  input: { speakerId: string; userId: string; email: string },
): Promise<boolean> {
  const evidence = invitationMailboxEvidence(input);
  return Boolean(await first(db, evidence.sql, [...evidence.bindings]));
}

/**
 * What lets a speaker page change the person's own name or headshot: a live
 * session, an account nobody has claimed yet, or the mailbox proof the person
 * just completed on this speaker link.
 */
export type SpeakerAccountAuthority =
  | { sessionId: string }
  | "unclaimed"
  | { provedMailbox: { email: string; capabilityId: string; expiresAt: number } };

export function speakerAccountSignInRequiredError(): AppError {
  return new AppError(
    403,
    "SPEAKER_ACCOUNT_SIGN_IN_REQUIRED",
    "Sign in to change the name or photo on your account. Your speaker link changes only this proposal.",
  );
}

/** A session-routed authority or a live session of the same person counts; else only an unclaimed account. */
export function speakerAccountAuthority(input: {
  authority: ParticipantAuthority;
  session?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
  userId: string;
  accountClaimed: boolean;
}): SpeakerAccountAuthority | null {
  if (typeof input.authority !== "string" && input.authority.userId === input.userId && input.authority.sessionId)
    return { sessionId: input.authority.sessionId };
  if (input.session?.userId === input.userId && input.session.sessionId) return { sessionId: input.session.sessionId };
  return input.accountClaimed ? null : "unclaimed";
}

/** Reads the person's live session only when the link alone would not do. */
export async function resolveSpeakerAccountAuthority(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  input: { authority: ParticipantAuthority; userId: string; accountClaimed: boolean },
): Promise<SpeakerAccountAuthority | null> {
  const linkOnly = speakerAccountAuthority(input);
  if (linkOnly || typeof input.authority !== "string") return linkOnly;
  const session = await resolveOptionalIdentityFromRequest(db, request, env);
  return speakerAccountAuthority({ ...input, session });
}

/**
 * The continuation token of a mailbox proof made on this speaker link, for
 * this speaker's own account, speaks for that account in the same step: it
 * already lets the person write their profile, so it lets them add their
 * photo too. A proof for another link, invitation round or person is refused.
 */
export async function resolveSpeakerMailboxProofAuthority(input: {
  signingSecret: string;
  continuationToken: string;
  eventId: string;
  speakerId: string;
  userId: string;
  inviteGeneration: number;
}): Promise<SpeakerAccountAuthority> {
  const payload = await verifyEventProposalCapability(
    input.signingSecret,
    input.continuationToken,
    input.eventId,
    true,
  );
  const context = payload.context;
  if (
    payload.userId !== input.userId ||
    context?.kind !== "speaker" ||
    context.speakerId !== input.speakerId ||
    context.userId !== input.userId ||
    context.inviteGeneration !== input.inviteGeneration
  )
    throw speakerAccountSignInRequiredError();
  return {
    provedMailbox: { email: payload.email, capabilityId: payload.capabilityId, expiresAt: payload.expiresAt },
  };
}

/**
 * Rechecks the authority at commit: the session is still live, the mailbox is
 * still unproved, or the proved address is still this person's and the proof
 * is unexpired and was redeemed by nobody else.
 */
export function speakerAccountAuthorityEvidence(
  authority: SpeakerAccountAuthority,
  userId: string,
): AuthorizationEvidence {
  if (authority === "unclaimed")
    return {
      sql: `SELECT 1 FROM users person WHERE person.id = ? AND ${unclaimedAccountSql("person")}`,
      bindings: [userId],
    };
  if ("provedMailbox" in authority) {
    const proof = authority.provedMailbox;
    return {
      sql: `SELECT 1 FROM users person WHERE person.id = ? AND ? > CAST(strftime('%s','now') AS INTEGER)
          AND (person.normalized_email = ? OR EXISTS (SELECT 1 FROM user_emails alias
            WHERE alias.user_id = person.id AND alias.normalized_email = ?))
          AND NOT EXISTS (SELECT 1 FROM audit_log redeemed
            WHERE redeemed.idempotency_key = ? AND redeemed.actor_id IS NOT person.id)`,
      bindings: [
        userId,
        proof.expiresAt,
        proof.email,
        proof.email,
        eventProposalProofRedemptionKey(proof.capabilityId),
      ],
    };
  }
  return {
    sql: `SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    bindings: [authority.sessionId, userId],
  };
}
