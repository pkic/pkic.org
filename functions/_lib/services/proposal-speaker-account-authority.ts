/**
 * A speaker link speaks for one proposal's participation, not for the person
 * who holds the account. The person's own name and headshot are shown on every
 * proposal, badge and agenda, so a link alone changes them only while nobody
 * has ever proved the account's mailbox: an account only an invitation made.
 * Once the mailbox is proved, the change needs that person's live session (or
 * a fresh mailbox proof, which the proof flow checks itself).
 */
import { resolveOptionalIdentityFromRequest, type AuthenticatedIdentity } from "../auth/user-session";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, Env } from "../types";
import type { ParticipantAuthority } from "./participant-authority";

/** The account has no proved mailbox: no verified primary address and no verified secondary one. */
export function unclaimedAccountSql(person: string): string {
  return `(${person}.email_verified_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM user_emails claimed WHERE claimed.user_id = ${person}.id AND claimed.verified_at IS NOT NULL))`;
}

/**
 * Whether the speaker link could only ever have been mailed to `email`: the
 * account is unclaimed and holds that one address, with no alias an invitation
 * could have been sent to instead. Opening the link then proved that mailbox.
 */
export async function isInvitationOnlyAddress(db: DatabaseLike, userId: string, email: string): Promise<boolean> {
  return Boolean(
    await first(
      db,
      `SELECT 1 FROM users person
        WHERE person.id = ? AND person.normalized_email = ? AND ${unclaimedAccountSql("person")}
          AND NOT EXISTS (SELECT 1 FROM user_emails alias
            WHERE alias.user_id = person.id AND alias.normalized_email <> person.normalized_email)`,
      [userId, email],
    ),
  );
}

/** What lets a speaker page change the person's own name or headshot. */
export type SpeakerAccountAuthority = { sessionId: string } | "unclaimed";

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

/** Rechecks the authority at commit: the session is still live, or the mailbox is still unproved. */
export function speakerAccountAuthorityEvidence(
  authority: SpeakerAccountAuthority,
  userId: string,
): AuthorizationEvidence {
  return authority === "unclaimed"
    ? { sql: `SELECT 1 FROM users person WHERE person.id = ? AND ${unclaimedAccountSql("person")}`, bindings: [userId] }
    : {
        sql: `SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL
          AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        bindings: [authority.sessionId, userId],
      };
}
