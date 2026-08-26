import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, Env, StatementLike } from "../types";
import { randomToken, sha256Hex } from "../utils/crypto";
import { uuid } from "../utils/ids";
import { addHours, addMinutes, nowIso } from "../utils/time";
import { verifyCapabilityToken, verifyDatabaseCapability } from "./capability-links";
import {
  findMeetingGuestCapabilitySnapshot,
  requireLiveMeetingGuest,
  toMeetingGuest,
  type MeetingGuest,
  type MeetingGuestRow,
} from "./meeting-guest-record";

const CHALLENGE_AUTHORIZATION_DOMAIN = "pkic-meeting-guest-authorization:v1";
const DEFAULT_CHALLENGE_TTL_MINUTES = 10;

function meetingGuestInvitationVerificationError(reason: "invalid" | "expired"): AppError {
  return new AppError(
    reason === "expired" ? 410 : 404,
    reason === "expired" ? "MEETING_GUEST_INVITATION_EXPIRED" : "MEETING_GUEST_INVITATION_INVALID",
    reason === "expired" ? "Meeting invitation has expired" : "Meeting invitation is invalid",
  );
}

export interface PreparedMeetingGuestBrowserChallenge {
  challengeId: string;
  browserSecret: string;
  verificationCode: string;
  authorizationHash: string;
  expiresAt: string;
  statement: StatementLike;
}

export async function verifyMeetingGuestInvitationCapability(
  db: DatabaseLike,
  token: string,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<MeetingGuest> {
  if (!env?.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }
  const verified = await verifyDatabaseCapability({
    db,
    signingSecret: env.INTERNAL_SIGNING_SECRET,
    purpose: "meeting_guest_verify",
    token,
  });
  if (!verified.ok) {
    throw meetingGuestInvitationVerificationError(verified.reason);
  }
  const snapshot = requireLiveMeetingGuest(await findMeetingGuestCapabilitySnapshot(db, verified.resourceId));
  const snapshotVerification = await verifyCapabilityToken({
    signingSecret: env.INTERNAL_SIGNING_SECRET,
    linkSecret: snapshot.invitation_secret,
    purpose: "meeting_guest_verify",
    token,
  });
  if (!snapshotVerification.ok) throw meetingGuestInvitationVerificationError(snapshotVerification.reason);
  if (snapshotVerification.resourceId !== snapshot.id) throw meetingGuestInvitationVerificationError("invalid");
  return toMeetingGuest(snapshot);
}

/** Public bootstrap intentionally does not reveal whether a guest capability expired or was revoked. */
export async function verifyMeetingGuestInvitationForBootstrap(
  db: DatabaseLike,
  token: string,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<MeetingGuest> {
  try {
    return await verifyMeetingGuestInvitationCapability(db, token, env);
  } catch (error) {
    if (
      error instanceof AppError &&
      [
        "MEETING_GUEST_INVITATION_EXPIRED",
        "MEETING_GUEST_INVITATION_INVALID",
        "MEETING_GUEST_INVITATION_INACTIVE",
      ].includes(error.code)
    ) {
      throw new AppError(
        404,
        "MEETING_GUEST_INVITATION_INVALID",
        "Meeting invitation is invalid or no longer eligible",
      );
    }
    throw error;
  }
}

function generateVerificationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => alphabet[value & 31]).join("");
}

export async function deriveMeetingGuestAuthorizationHash(payload: {
  challengeId: string;
  browserSecret: string;
  verificationCode: string;
}): Promise<string> {
  return sha256Hex(
    `${CHALLENGE_AUTHORIZATION_DOMAIN}\0${payload.challengeId}\0${payload.browserSecret}\0${payload.verificationCode}`,
  );
}

export async function prepareMeetingGuestBrowserChallenge(
  db: DatabaseLike,
  guest: MeetingGuest,
  occurrenceId: string,
  ttlMinutes = DEFAULT_CHALLENGE_TTL_MINUTES,
): Promise<PreparedMeetingGuestBrowserChallenge> {
  const challengeId = uuid();
  const browserSecret = randomToken(24);
  const verificationCode = generateVerificationCode();
  const authorizationHash = await deriveMeetingGuestAuthorizationHash({
    challengeId,
    browserSecret,
    verificationCode,
  });
  const createdAt = nowIso();
  const requestedExpiresAt = addMinutes(createdAt, Math.max(1, Math.floor(ttlMinutes)));
  const expiresAt = new Date(
    Math.min(new Date(requestedExpiresAt).getTime(), new Date(guest.expiresAt).getTime()),
  ).toISOString();
  return {
    challengeId,
    browserSecret,
    verificationCode,
    authorizationHash,
    expiresAt,
    statement: db
      .prepare(
        `INSERT INTO meeting_guest_browser_challenges
           (id, guest_id, occurrence_id, invitation_version, authorization_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(challengeId, guest.guestId, occurrenceId, guest.invitationVersion, authorizationHash, expiresAt, createdAt),
  };
}

interface MeetingGuestChallengeRow extends MeetingGuestRow {
  challenge_id: string;
  challenge_occurrence_id: string;
  challenge_expires_at: string;
  challenge_used_at: string | null;
  challenge_invitation_version: number;
  authorization_hash: string;
}

function assertUsableMeetingGuestChallenge(challenge: MeetingGuestChallengeRow | null): MeetingGuestChallengeRow {
  if (!challenge) {
    throw new AppError(401, "MEETING_GUEST_CHALLENGE_INVALID", "Meeting guest verification is invalid or expired");
  }
  if (challenge.challenge_used_at) {
    throw new AppError(409, "MEETING_GUEST_CHALLENGE_USED", "Meeting guest verification was already used");
  }
  if (
    new Date(challenge.challenge_expires_at).getTime() <= Date.now() ||
    new Date(challenge.expires_at).getTime() <= Date.now() ||
    challenge.revoked_at ||
    challenge.challenge_invitation_version !== challenge.invitation_version
  ) {
    throw new AppError(410, "MEETING_GUEST_CHALLENGE_EXPIRED", "Meeting guest verification has expired");
  }
  return challenge;
}

export async function issueMeetingGuestSession(
  db: DatabaseLike,
  payload: { challengeId: string; authorizationHash: string; sessionTtlHours: number },
): Promise<{
  guest: MeetingGuest;
  sessionId: string;
  occurrenceId: string;
  authorizationHash: string;
  expiresAt: string;
}> {
  const challenge = assertUsableMeetingGuestChallenge(
    await first<MeetingGuestChallengeRow>(
      db,
      `SELECT guest.id, guest.series_id, guest.occurrence_id, guest.normalized_email,
            guest.name, guest.affiliation, guest.expires_at, guest.revoked_at,
            guest.invitation_version, challenge.id AS challenge_id, challenge.authorization_hash,
            challenge.occurrence_id AS challenge_occurrence_id,
            challenge.expires_at AS challenge_expires_at, challenge.used_at AS challenge_used_at,
            challenge.invitation_version AS challenge_invitation_version
       FROM meeting_guest_browser_challenges challenge
       JOIN event_occurrence_guests guest ON guest.id = challenge.guest_id
      WHERE challenge.id = ? AND challenge.authorization_hash = ?`,
      [payload.challengeId, payload.authorizationHash],
    ),
  );
  const createdAt = nowIso();
  const requestedExpiresAt = addHours(createdAt, Math.max(1, payload.sessionTtlHours));
  const expiresAt = new Date(
    Math.min(new Date(requestedExpiresAt).getTime(), new Date(challenge.expires_at).getTime()),
  ).toISOString();
  const sessionId = uuid();
  try {
    await db
      .prepare(
        `INSERT INTO meeting_guest_sessions
           (id, guest_id, challenge_id, authorization_hash, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(sessionId, challenge.id, challenge.challenge_id, challenge.authorization_hash, expiresAt, createdAt)
      .run();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("MEETING_GUEST_SESSION_CONTEXT_CHANGED") ||
        error.message.includes("meeting_guest_sessions.challenge_id"))
    ) {
      const current = await first<MeetingGuestChallengeRow>(
        db,
        `SELECT guest.id, guest.series_id, guest.occurrence_id, guest.normalized_email,
                guest.name, guest.affiliation, guest.expires_at, guest.revoked_at,
                guest.invitation_version, challenge.id AS challenge_id, challenge.authorization_hash,
                challenge.occurrence_id AS challenge_occurrence_id,
                challenge.expires_at AS challenge_expires_at, challenge.used_at AS challenge_used_at,
                challenge.invitation_version AS challenge_invitation_version
           FROM meeting_guest_browser_challenges challenge
           JOIN event_occurrence_guests guest ON guest.id = challenge.guest_id
          WHERE challenge.id = ? AND challenge.authorization_hash = ?`,
        [payload.challengeId, payload.authorizationHash],
      );
      assertUsableMeetingGuestChallenge(current);
      throw new AppError(409, "MEETING_GUEST_CHALLENGE_USED", "Meeting guest verification was already used");
    }
    throw error;
  }
  return {
    guest: toMeetingGuest(challenge),
    sessionId,
    authorizationHash: challenge.authorization_hash,
    expiresAt,
    occurrenceId: challenge.challenge_occurrence_id,
  };
}
