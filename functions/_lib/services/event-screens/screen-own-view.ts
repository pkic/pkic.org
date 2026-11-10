import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import {
  SCREEN_SESSION_ERROR_CODES,
  screenOwnViewSchema,
  type ScreenOwnView,
} from "../../../../assets/shared/schemas/event-screens";
import { signLiveOverlayToken } from "../../auth/live-session-overlay-token";
import type { ScreenSessionClaims } from "../../auth/screen-session";
import { assertSessionActive } from "../../auth/session-engine";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { addHours, addMinutes, nowIso } from "../../utils/time";

const SCREEN_REFUSALS = {
  invalid: SCREEN_SESSION_ERROR_CODES.missing,
  revoked: SCREEN_SESSION_ERROR_CODES.revoked,
  expired: SCREEN_SESSION_ERROR_CODES.expired,
};

export function screenSessionMissing(): AppError {
  return new AppError(401, SCREEN_SESSION_ERROR_CODES.missing, "This screen is not paired. Show a pairing code.");
}

export function screenSessionExpired(): AppError {
  return new AppError(401, SCREEN_SESSION_ERROR_CODES.expired, "This screen's sign-in expired. Show a pairing code.");
}

interface OwnViewRow {
  session_activated_at: string | null;
  session_revoked_at: string | null;
  session_expires_at: string;
  id: string;
  name: string;
  event_id: string | null;
  event_slug: string | null;
  room_id: string | null;
  room_name: string | null;
  output: string | null;
  layout: string | null;
  assigned_by: string | null;
}

/**
 * A paired screen reads itself in one batch. Its sign-in is renewed when the
 * last renewal is a day old, and its last-seen time moves at most every few
 * minutes; both writes only touch a live session. While assigned, it gets a
 * short-lived overlay access for its room, attributed to who assigned it.
 */
export async function readScreenOwnView(
  db: DatabaseLike,
  secret: string,
  claims: ScreenSessionClaims,
): Promise<{ view: ScreenOwnView; renewedUntil: string | null }> {
  const now = nowIso();
  const renewedUntil = addHours(now, SCREEN_POLICY.sessionDays * 24);
  const renewBefore = addHours(renewedUntil, -SCREEN_POLICY.sessionRenewalHours);
  const seenBefore = addMinutes(now, -SCREEN_POLICY.lastSeenMinutes);
  const live = "id=? AND screen_id=? AND activated_at IS NOT NULL AND revoked_at IS NULL AND expires_at>?";
  const [, , read] = await db.batch([
    db
      .prepare(`UPDATE screen_sessions SET expires_at=? WHERE ${live} AND expires_at<?`)
      .bind(renewedUntil, claims.sid, claims.sub, now, renewBefore),
    db
      .prepare(`UPDATE screen_sessions SET last_seen_at=? WHERE ${live} AND (last_seen_at IS NULL OR last_seen_at<?)`)
      .bind(now, claims.sid, claims.sub, now, seenBefore),
    db
      .prepare(
        `SELECT session.activated_at AS session_activated_at,session.revoked_at AS session_revoked_at,
                session.expires_at AS session_expires_at,screen.id,screen.name,screen.event_id,event.slug AS event_slug,
                screen.room_id,room.name AS room_name,screen.output,screen.layout,screen.assigned_by
           FROM screen_sessions session JOIN screens screen ON screen.id=session.screen_id
           LEFT JOIN events event ON event.id=screen.event_id
           LEFT JOIN event_agenda_rooms room ON room.id=screen.room_id AND room.event_id=screen.event_id
          WHERE session.id=? AND session.screen_id=?`,
      )
      .bind(claims.sid, claims.sub),
  ]);
  const row = batchFirst<OwnViewRow>(read);
  const session = assertSessionActive(
    row && row.session_activated_at ? { revokedAt: row.session_revoked_at, expiresAt: row.session_expires_at } : null,
    "screen",
    SCREEN_REFUSALS,
  );
  const screen = row!;
  const assigned =
    screen.event_id &&
    screen.event_slug &&
    screen.room_id &&
    screen.room_name !== null &&
    screen.output &&
    screen.assigned_by;
  const overlayExpiresAt = addMinutes(now, SCREEN_POLICY.overlayAccessMinutes);
  const view = screenOwnViewSchema.parse({
    viewer: "screen",
    screen: {
      id: screen.id,
      name: screen.name,
      assignment: assigned
        ? {
            eventSlug: screen.event_slug,
            roomId: screen.room_id,
            roomName: screen.room_name,
            output: screen.output,
            layout: screen.layout,
          }
        : null,
    },
    serverNow: now,
    overlay: assigned
      ? {
          token: await signLiveOverlayToken(secret, {
            eventId: screen.event_id!,
            roomId: screen.room_id!,
            issuedBy: screen.assigned_by!,
            screenId: screen.id,
            expiresAt: overlayExpiresAt,
          }),
          expiresAt: overlayExpiresAt,
        }
      : null,
  });
  return { view, renewedUntil: session.expiresAt === renewedUntil ? renewedUntil : null };
}
