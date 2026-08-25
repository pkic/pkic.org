import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, Env, StatementLike } from "../types";
import { randomToken, sha256Hex } from "../utils/crypto";
import { uuid } from "../utils/ids";
import { addHours, addMinutes, nowIso } from "../utils/time";
import { verifyDatabaseCapability } from "./capability-links";
import {
  findMeetingGuest,
  requireLiveMeetingGuest,
  toMeetingGuest,
  type MeetingGuest,
  type MeetingGuestRow,
} from "./meeting-guest-record";

const CHALLENGE_AUTHORIZATION_DOMAIN = "pkic-meeting-guest-authorization:v1";
const DEFAULT_CHALLENGE_TTL_MINUTES = 10;

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
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "MEETING_GUEST_INVITATION_EXPIRED" : "MEETING_GUEST_INVITATION_INVALID",
      verified.reason === "expired" ? "Meeting invitation has expired" : "Meeting invitation is invalid",
    );
  }
  return toMeetingGuest(requireLiveMeetingGuest(await findMeetingGuest(db, verified.resourceId)));
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
  authorization_hash: string;
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
  const challenge = await first<MeetingGuestChallengeRow>(
    db,
    `SELECT guest.id, guest.series_id, guest.occurrence_id, guest.normalized_email,
            guest.name, guest.affiliation, guest.expires_at, guest.revoked_at,
            guest.invitation_version, challenge.id AS challenge_id, challenge.authorization_hash,
            challenge.occurrence_id AS challenge_occurrence_id
       FROM meeting_guest_browser_challenges challenge
       JOIN event_occurrence_guests guest ON guest.id = challenge.guest_id
      WHERE challenge.id = ? AND challenge.authorization_hash = ?
        AND challenge.used_at IS NULL AND unixepoch(challenge.expires_at) > unixepoch()
        AND challenge.invitation_version = guest.invitation_version`,
    [payload.challengeId, payload.authorizationHash],
  );
  if (!challenge || challenge.revoked_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "MEETING_GUEST_CHALLENGE_INVALID", "Meeting guest verification is invalid or expired");
  }
  const createdAt = nowIso();
  const requestedExpiresAt = addHours(createdAt, Math.max(1, payload.sessionTtlHours));
  const expiresAt = new Date(
    Math.min(new Date(requestedExpiresAt).getTime(), new Date(challenge.expires_at).getTime()),
  ).toISOString();
  const sessionId = uuid();
  const tokenHash = await sha256Hex(randomToken(24));
  try {
    await db
      .prepare(
        `INSERT INTO meeting_guest_sessions
           (id, guest_id, token_hash, challenge_id, authorization_hash, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        sessionId,
        challenge.id,
        tokenHash,
        challenge.challenge_id,
        challenge.authorization_hash,
        expiresAt,
        createdAt,
      )
      .run();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("MEETING_GUEST_SESSION_CONTEXT_CHANGED") ||
        error.message.includes("meeting_guest_sessions.challenge_id"))
    ) {
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
