import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, Env } from "../types";
import { constantTimeEqual } from "../utils/crypto";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import { nowIso } from "../utils/time";
import {
  EFFECTIVE_MEETING_GUEST_FROM,
  effectiveMeetingGuestColumns,
  toMeetingGuest,
  type MeetingGuest,
  type MeetingGuestRow,
} from "./meeting-guest-record";
import {
  assertSessionActive,
  getBearerToken,
  getSessionCookieToken,
  hasBaseSessionTokenClaims,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  sessionExpiresAtToExp,
} from "./session-engine";
import { MEETING_GUEST_CHALLENGE_COOKIE_NAME, MEETING_GUEST_SESSION_COOKIE_NAME } from "./session-cookies";

const MEETING_GUEST_SESSION_TOKEN_TYPE = "meeting-guest-session";

export interface MeetingGuestSession extends MeetingGuest {
  sessionId: string;
  verifiedOccurrenceId: string;
  expiresAt: string;
}

export interface MeetingGuestSessionTokenClaims {
  typ: "meeting-guest-session";
  sub: string;
  sid: string;
  authorizationHash: string;
  exp: number;
}

interface MeetingGuestSessionRow extends MeetingGuestRow {
  session_id: string;
  session_expires_at: string;
  session_revoked_at: string | null;
  session_authorization_hash: string;
  challenge_authorization_hash: string;
  challenge_invitation_version: number;
  challenge_used_at: string | null;
  challenge_occurrence_id: string;
}

function isMeetingGuestSessionTokenClaims(claims: object): claims is MeetingGuestSessionTokenClaims {
  if (!hasBaseSessionTokenClaims(claims, MEETING_GUEST_SESSION_TOKEN_TYPE)) return false;
  const candidate = claims as Partial<MeetingGuestSessionTokenClaims>;
  return typeof candidate.authorizationHash === "string" && /^[a-f0-9]{64}$/i.test(candidate.authorizationHash);
}

export async function signMeetingGuestSessionToken(
  secret: string,
  payload: { guestId: string; sessionId: string; authorizationHash: string; expiresAt: string },
): Promise<string> {
  const claims: MeetingGuestSessionTokenClaims = {
    typ: MEETING_GUEST_SESSION_TOKEN_TYPE,
    sub: payload.guestId,
    sid: payload.sessionId,
    authorizationHash: payload.authorizationHash,
    exp: sessionExpiresAtToExp(payload.expiresAt),
  };
  return signJwt(secret, { ...claims });
}

export async function verifyMeetingGuestSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<MeetingGuestSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) return result;
  if (!isMeetingGuestSessionTokenClaims(result.claims)) return { ok: false, reason: "invalid" };
  return { ok: true, claims: result.claims };
}

export function getMeetingGuestSessionCookieToken(request: Request): string | null {
  return getSessionCookieToken(request, MEETING_GUEST_SESSION_COOKIE_NAME);
}

export function getMeetingGuestChallengeCookieSecret(request: Request): string | null {
  return getSessionCookieToken(request, MEETING_GUEST_CHALLENGE_COOKIE_NAME);
}

function meetingOccurrenceCookiePath(occurrenceId: string): string {
  return `/api/v1/meetings/occurrences/${encodeURIComponent(occurrenceId)}`;
}

function meetingVerificationCookiePath(occurrenceId: string): string {
  return `${meetingOccurrenceCookiePath(occurrenceId)}/invitations/verifications`;
}

export function serializeMeetingGuestChallengeCookie(
  browserSecret: string,
  occurrenceId: string,
  request: Request,
): string {
  return serializeSessionCookie(
    MEETING_GUEST_CHALLENGE_COOKIE_NAME,
    meetingVerificationCookiePath(occurrenceId),
    browserSecret,
    request,
  );
}

export function serializeExpiredMeetingGuestChallengeCookie(occurrenceId: string, request: Request): string {
  return serializeExpiredSessionCookie(
    MEETING_GUEST_CHALLENGE_COOKIE_NAME,
    meetingVerificationCookiePath(occurrenceId),
    request,
  );
}

export function serializeMeetingGuestSessionCookie(token: string, occurrenceId: string, request: Request): string {
  return serializeSessionCookie(
    MEETING_GUEST_SESSION_COOKIE_NAME,
    meetingOccurrenceCookiePath(occurrenceId),
    token,
    request,
  );
}

export function serializeExpiredMeetingGuestSessionCookie(occurrenceId: string, request: Request): string {
  return serializeExpiredSessionCookie(
    MEETING_GUEST_SESSION_COOKIE_NAME,
    meetingOccurrenceCookiePath(occurrenceId),
    request,
  );
}

export async function requireMeetingGuestFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<MeetingGuestSession> {
  const token = getBearerToken(request) ?? getMeetingGuestSessionCookieToken(request);
  if (!token) throw new AppError(401, "AUTH_REQUIRED", "Missing meeting guest session token");
  return requireMeetingGuestSessionToken(db, token, env);
}

/** Resolve an explicitly selected guest token without competing user-session transport precedence. */
export async function requireMeetingGuestSessionToken(
  db: DatabaseLike,
  token: string,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<MeetingGuestSession> {
  if (!env?.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }
  const verified = await verifyMeetingGuestSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "Meeting guest session expired" : "Invalid meeting guest session token",
    );
  }
  const row = await first<MeetingGuestSessionRow>(
    db,
    `SELECT ${effectiveMeetingGuestColumns()}, session.id AS session_id,
            session.expires_at AS session_expires_at, session.revoked_at AS session_revoked_at,
            session.authorization_hash AS session_authorization_hash,
            challenge.authorization_hash AS challenge_authorization_hash,
            challenge.invitation_version AS challenge_invitation_version,
            challenge.used_at AS challenge_used_at,
            challenge.occurrence_id AS challenge_occurrence_id
       ${EFFECTIVE_MEETING_GUEST_FROM}
       JOIN meeting_guest_sessions session ON session.guest_id = guest.id
       JOIN meeting_guest_browser_challenges challenge
         ON challenge.id = session.challenge_id AND challenge.guest_id = guest.id
      WHERE session.id = ? AND session.guest_id = ?`,
    [verified.claims.sid, verified.claims.sub],
  );
  if (!row) throw new AppError(401, "AUTH_INVALID", "Invalid meeting guest session token");
  assertSessionActive({ revokedAt: row.session_revoked_at, expiresAt: row.session_expires_at }, "meeting guest");
  if (
    !row.challenge_used_at ||
    row.challenge_invitation_version !== row.invitation_version ||
    row.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This meeting guest invitation is no longer active");
  }
  if (
    !(await constantTimeEqual(verified.claims.authorizationHash, row.session_authorization_hash)) ||
    !(await constantTimeEqual(row.session_authorization_hash, row.challenge_authorization_hash))
  ) {
    throw new AppError(401, "AUTH_INVALID", "Invalid meeting guest session token");
  }
  return {
    ...toMeetingGuest(row),
    sessionId: row.session_id,
    verifiedOccurrenceId: row.challenge_occurrence_id,
    expiresAt: row.session_expires_at,
  };
}

export async function revokeMeetingGuestSession(db: DatabaseLike, sessionId: string): Promise<void> {
  await db
    .prepare("UPDATE meeting_guest_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
    .bind(nowIso(), sessionId)
    .run();
}
