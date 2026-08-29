import type { MeetingJoinSubject } from "../services/event-series";
import type { DatabaseLike, Env } from "../types";
import { AppError } from "../errors";
import {
  getMeetingGuestSessionCookieToken,
  requireMeetingGuestSessionToken,
  type MeetingGuestSession,
} from "./meeting-guest-session";
import { requireMemberFromRequest } from "./member";
import { getBearerToken } from "./session-engine";
import { getUserSessionToken } from "./user-session";

function guestSubject(guest: MeetingGuestSession, occurrenceId: string): MeetingJoinSubject {
  if (guest.verifiedOccurrenceId !== occurrenceId) {
    throw new AppError(403, "MEETING_GUEST_OCCURRENCE_FORBIDDEN", "Guest session is not valid for this occurrence");
  }
  return { kind: "guest", guestId: guest.guestId, sessionId: guest.sessionId };
}

function capturedError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unexpected meeting join authorization failure", { cause: error });
}

async function memberSubject(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<MeetingJoinSubject> {
  const member = await requireMemberFromRequest(db, request, env);
  if (!member.sessionId) throw new AppError(401, "AUTH_INVALID", "Member session is unavailable");
  return { kind: "member", userId: member.userId, sessionId: member.sessionId };
}

/**
 * Resolve one attendee identity from the canonical transports. A live member
 * capacity takes precedence, while a separately verified occurrence-bound
 * guest session remains available to staff-only or unauthenticated invitees.
 */
export async function resolveMeetingJoinSubjectFromRequest(
  db: DatabaseLike,
  request: Request,
  occurrenceId: string,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<MeetingJoinSubject> {
  let userSessionError: Error | undefined;
  if (getUserSessionToken(request)) {
    try {
      return await memberSubject(db, request, env);
    } catch (error) {
      userSessionError = capturedError(error);
    }
  }

  const guestCookieToken = getMeetingGuestSessionCookieToken(request);
  const bearerToken = getBearerToken(request);
  const guestTokens = [...new Set([guestCookieToken, bearerToken].filter((token): token is string => Boolean(token)))];
  let guestSessionError: Error | undefined;
  for (const token of guestTokens) {
    try {
      return guestSubject(await requireMeetingGuestSessionToken(db, token, env), occurrenceId);
    } catch (error) {
      guestSessionError = capturedError(error);
    }
  }

  if (guestSessionError) throw guestSessionError;
  if (userSessionError) throw userSessionError;
  throw new AppError(401, "AUTH_REQUIRED", "A member or verified guest session is required");
}
