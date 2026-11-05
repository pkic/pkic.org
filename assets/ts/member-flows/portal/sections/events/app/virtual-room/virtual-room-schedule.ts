/**
 * What a location's virtual room shows at a moment, read from the published agenda the app already loads:
 * the session running there now, the ones that follow, and the next instant at which that answer changes.
 * The browser clock is compared with agenda times; nothing polls the server.
 */
import { ONLINE_JOIN_LEAD_MS } from "../../../../../../../shared/event-agenda-media";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { dateTimeLocalToIso, instantToCalendarDate } from "../../../../../../../shared/timezone";

export type RoomSession = AgendaOccurrence & { startAt: string; endAt: string };

/** How many sessions "Now & next" lists after the one running. */
export const UPCOMING_SHOWN = 4;

/** Scheduled sessions held in a location (as primary or additional room), in time order. */
export function locationSessions(agenda: Pick<AgendaSnapshot, "occurrences">, roomId: string): RoomSession[] {
  return agenda.occurrences
    .filter(
      (occurrence): occurrence is RoomSession =>
        Boolean(occurrence.startAt && occurrence.endAt) &&
        (occurrence.roomId === roomId || Boolean(occurrence.additionalRoomIds?.includes(roomId))),
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
}

export interface RoomMoment {
  /** The session running at this moment, if any. */
  current: RoomSession | null;
  /** The sessions after it (or, between sessions, the next ones) including later event days. */
  upcoming: RoomSession[];
}

/** The location's running session and the next scheduled sessions, including later event days. */
export function roomMoment(sessions: readonly RoomSession[], now: number): RoomMoment {
  const instant = new Date(now).toISOString();
  const current = sessions.find((session) => session.startAt <= instant && instant < session.endAt) ?? null;
  const upcoming = sessions
    .filter((session) => session !== current && session.startAt > instant)
    .slice(0, UPCOMING_SHOWN);
  return { current, upcoming };
}

/**
 * The next instant after `now` at which the room's answer can change: the first join window opening, a
 * session start or end, or the next event day (when a location's stream may switch to that day's replacement). Null when none is ahead.
 */
export function nextRoomBoundary(sessions: readonly RoomSession[], now: number, timeZone: string): number | null {
  const instant = new Date(now).toISOString();
  const tomorrow = new Date(`${instantToCalendarDate(instant, timeZone)}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const midnight = Date.parse(dateTimeLocalToIso(`${tomorrow.toISOString().slice(0, 10)}T00:00`, timeZone));
  let next: number | null = Number.isFinite(midnight) && midnight > now ? midnight : null;
  const opensAt = Date.parse(sessions[0]?.startAt ?? "") - ONLINE_JOIN_LEAD_MS;
  if (opensAt > now && (next === null || opensAt < next)) next = opensAt;
  for (const session of sessions)
    for (const at of [Date.parse(session.startAt), Date.parse(session.endAt)]) {
      if (at > now && (next === null || at < next)) next = at;
    }
  return next;
}

/** Follow a linked session's current rooms; otherwise use the requested location or first streamed one. */
export function chooseLocation(
  locations: ReadonlyArray<{ id: string }>,
  agenda: Pick<AgendaSnapshot, "occurrences"> | null,
  requested: { room?: string | null; session?: string | null },
): string | null {
  const known = (id: string | null | undefined) => (id && locations.some((location) => location.id === id) ? id : null);
  const session = requested.session
    ? agenda?.occurrences.find((occurrence) => occurrence.id === requested.session)
    : null;
  if (session) {
    const roomIds = [session.roomId, ...(session.additionalRoomIds ?? [])];
    const requestedRoom = known(requested.room);
    if (requestedRoom && roomIds.includes(requestedRoom)) return requestedRoom;
    return roomIds.map(known).find(Boolean) ?? null;
  }
  return known(requested.room) ?? locations[0]?.id ?? null;
}

/**
 * The session a reader followed a link to, when it is not on at `now`: it has ended or has not started,
 * so the room is showing something else. Null when it is on, or when no session was asked for.
 */
export function requestedSessionNotice(
  agenda: Pick<AgendaSnapshot, "occurrences"> | null,
  sessionId: string | null,
  now: number,
): { session: RoomSession; state: "ended" | "upcoming" } | null {
  const session = sessionId ? agenda?.occurrences.find((occurrence) => occurrence.id === sessionId) : undefined;
  if (!session?.startAt || !session.endAt) return null;
  const instant = new Date(now).toISOString();
  if (instant >= session.endAt) return { session: session as RoomSession, state: "ended" };
  if (instant < session.startAt) return { session: session as RoomSession, state: "upcoming" };
  return null;
}

/** The credited people of a session, as one line. */
export function sessionSpeakerLine(session: Pick<AgendaOccurrence, "speakers">): string {
  return session.speakers.map((speaker) => speaker.displayName).join(", ");
}
