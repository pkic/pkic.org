import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import {
  SCREEN_SESSION_ERROR_CODES,
  screenAgendaSessionSchema,
  screenOwnViewSchema,
  type ScreenOwnView,
} from "../../../../assets/shared/schemas/event-screens";
import { locationStreamOn, type LiveStream } from "../../../../assets/shared/schemas/event-live-stream";
import { timeZoneSchema } from "../../../../assets/shared/schemas/event-series";
import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import { signLiveOverlayToken } from "../../auth/live-session-overlay-token";
import type { ScreenSessionClaims } from "../../auth/screen-session";
import { assertSessionActive } from "../../auth/session-engine";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { addHours, addMinutes, nowIso } from "../../utils/time";
import { parseJsonSafe } from "../../utils/json";
import { locationStreams, type LiveStreamRow } from "../event-agenda/location-live-streams";

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

interface AgendaRow {
  revision: number;
  time_zone: string | null;
  sessions_json: string | null;
}

/** A published session's field, read from the stored snapshot. */
const field = (name: string) => `json_extract(item.value,'$.${name}')`;

/**
 * The screen's room in the published agenda: the public, timed sessions
 * placed in it (or plenaries placed nowhere, which every room shows) that
 * overlap the window, earliest first and bounded. The sessions are left out
 * when the screen already holds the published revision.
 */
const AGENDA_SQL = `SELECT state.published_revision AS revision,
       json_extract(publication.snapshot_json,'$.timeZone') AS time_zone,
       CASE WHEN state.published_revision IS ? THEN NULL ELSE (
         SELECT json_group_array(json(entry.session)) FROM (
           SELECT json_object('id',${field("id")},'title',${field("title")},'startAt',${field("startAt")},'endAt',${field("endAt")}) AS session
             FROM json_each(publication.snapshot_json,'$.occurrences') item
            WHERE ${field("visibility")}='public' AND COALESCE(${field("placeholder")},0)=0
              AND ${field("startAt")}<? AND ${field("endAt")}>? AND ${field("startAt")}<${field("endAt")}
              AND (${field("roomId")}=screen.room_id
                   OR EXISTS(SELECT 1 FROM json_each(COALESCE(${field("additionalRoomIds")},'[]')) extra WHERE extra.value=screen.room_id)
                   OR (${field("kind")}='plenary' AND ${field("roomId")} IS NULL
                       AND json_array_length(COALESCE(${field("additionalRoomIds")},'[]'))=0))
            ORDER BY ${field("startAt")},${field("id")} LIMIT ?) entry)
       END AS sessions_json
  FROM screen_sessions session JOIN screens screen ON screen.id=session.screen_id
  JOIN event_agenda_state state ON state.event_id=screen.event_id
  JOIN event_agenda_publications publication ON publication.event_id=state.event_id AND publication.revision=state.published_revision
 WHERE session.id=? AND session.screen_id=? AND screen.room_id IS NOT NULL`;

/** The agenda as the contract carries it; a session the contract refuses is left out, never the whole read. */
function screenAgenda(row: AgendaRow | null, from: string, to: string): ScreenOwnView["agenda"] {
  if (!row || row.revision === null) return null;
  const zone = timeZoneSchema.safeParse(row.time_zone);
  if (!zone.success) return null;
  const sessions =
    row.sessions_json === null
      ? null
      : parseJsonSafe<unknown[]>(row.sessions_json, []).flatMap((entry) => {
          const parsed = screenAgendaSessionSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        });
  return { revision: row.revision, timeZone: zone.data, from, to, sessions };
}

/**
 * The stream configuration of the screen's own room, read only while it is
 * assigned the livestream. A room holds its usual stream and at most one
 * replacement per event day, so the rows stay bounded.
 */
const LIVESTREAM_SQL = `SELECT stream.day_date,stream.provider,stream.stream_ref
  FROM screen_sessions session JOIN screens screen ON screen.id=session.screen_id
  JOIN event_agenda_room_streams stream ON stream.room_id=screen.room_id AND stream.event_id=screen.event_id
 WHERE session.id=? AND session.screen_id=? AND screen.output='livestream'
 ORDER BY stream.day_date IS NOT NULL,stream.day_date`;

/** The room's stream on the event day `now` falls on in the event's zone. */
function screenLivestream(rows: readonly LiveStreamRow[], now: string, timeZone: string | null): LiveStream | null {
  const zone = timeZoneSchema.safeParse(timeZone);
  if (!zone.success || rows.length === 0) return null;
  return locationStreamOn(locationStreams(rows), instantToCalendarDate(now, zone.data));
}

interface OwnViewRow {
  session_activated_at: string | null;
  session_revoked_at: string | null;
  session_expires_at: string;
  id: string;
  name: string;
  event_id: string | null;
  event_slug: string | null;
  event_time_zone: string | null;
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
 * short-lived overlay access for its room, attributed to who assigned it, and
 * its room's published agenda around now and, for the livestream, the
 * room's stream today, in the same batch.
 */
export async function readScreenOwnView(
  db: DatabaseLike,
  secret: string,
  claims: ScreenSessionClaims,
  agendaRevision: number | null = null,
): Promise<{ view: ScreenOwnView; renewedUntil: string | null }> {
  const now = nowIso();
  const renewedUntil = addHours(now, SCREEN_POLICY.sessionDays * 24);
  const renewBefore = addHours(renewedUntil, -SCREEN_POLICY.sessionRenewalHours);
  const seenBefore = addMinutes(now, -SCREEN_POLICY.lastSeenMinutes);
  const live = "id=? AND screen_id=? AND activated_at IS NOT NULL AND revoked_at IS NULL AND expires_at>?";
  const agendaFrom = addHours(now, -SCREEN_POLICY.agendaHoursBefore);
  const agendaTo = addHours(now, SCREEN_POLICY.agendaHoursAfter);
  const [, , read, agendaRead, livestreamRead] = await db.batch([
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
                event.timezone AS event_time_zone,
                screen.room_id,room.name AS room_name,screen.output,screen.layout,screen.assigned_by
           FROM screen_sessions session JOIN screens screen ON screen.id=session.screen_id
           LEFT JOIN events event ON event.id=screen.event_id
           LEFT JOIN event_agenda_rooms room ON room.id=screen.room_id AND room.event_id=screen.event_id
          WHERE session.id=? AND session.screen_id=?`,
      )
      .bind(claims.sid, claims.sub),
    db
      .prepare(AGENDA_SQL)
      .bind(agendaRevision, agendaTo, agendaFrom, SCREEN_POLICY.agendaMaxSessions, claims.sid, claims.sub),
    db.prepare(LIVESTREAM_SQL).bind(claims.sid, claims.sub),
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
    agenda: assigned ? screenAgenda(batchFirst<AgendaRow>(agendaRead), agendaFrom, agendaTo) : null,
    livestream:
      assigned && screen.output === "livestream"
        ? screenLivestream(batchRows<LiveStreamRow>(livestreamRead), now, screen.event_time_zone)
        : null,
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
