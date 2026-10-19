/**
 * Turns a verified point into what scanning it means right now on the event
 * clock: the day, and for room and session points the session. Room points
 * resolve to the session running in the room or the next one starting soon.
 */
import {
  resolveRoomSession,
  ROOM_SESSION_LEAD_MINUTES,
  sessionCheckInWindow,
  type AttendancePointRefusal,
  type AttendancePointSelection,
} from "../../../../assets/shared/attendance-points";
import { agendaOccurrenceRoomIds } from "../../../../assets/shared/event-agenda-rooms";
import { eventClockCity } from "../../../../assets/shared/event-clock";
import type { AttendancePointTarget } from "../../../../assets/shared/schemas/event-attendance-points";
import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { addMinutes } from "../../utils/time";
import { publishedRoomsSql, publishedSessionsSql } from "../event-participation/published-schedule";
import type { EventRecord } from "../event-types";
import { pointDaysCte } from "./point-days";

interface SessionRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  room_id: string | null;
  additional_room_ids_json: string;
}

export interface ResolvedSession {
  id: string;
  roomId: string | null;
  window: "open" | "not_open" | "ended";
  day: string;
}

export type PointResolution =
  | { kind: "venue"; target: AttendancePointTarget; eventDay: boolean }
  | { kind: "session"; target: AttendancePointTarget; session: ResolvedSession }
  | { kind: "refused"; reason: AttendancePointRefusal; target: AttendancePointTarget | null };

async function eventDays(db: DatabaseLike, event: EventRecord) {
  const days = pointDaysCte(event);
  return all<{ day_date: string; day_label: string }>(
    db,
    `WITH ${days.sql} SELECT day_date,day_label FROM point_days ORDER BY day_date`,
    days.bindings,
  );
}

const sessionColumns = "id,title,start_at,end_at,room_id,additional_room_ids_json";

/**
 * `today` and `timeZone` come from the capture context, so the day a code
 * resolves on is the day its observation is recorded on.
 */
export async function resolveAttendancePoint(
  db: DatabaseLike,
  event: EventRecord,
  selection: AttendancePointSelection,
  clock: { now: string; today: string; timeZone: string },
): Promise<PointResolution> {
  const days = await eventDays(db, event);
  const dayLabel = (date: string) => days.find((day) => day.day_date === date)?.day_label ?? null;
  const base = { timeZone: clock.timeZone, clockCity: eventClockCity(event.city) };
  if (selection.kind === "venue_check_in" || selection.kind === "venue_check_out") {
    const label = dayLabel(selection.dayDate);
    if (!label) return { kind: "refused", reason: "invalid_code", target: null };
    return {
      kind: "venue",
      eventDay: dayLabel(clock.today) !== null,
      target: {
        ...base,
        action: selection.kind === "venue_check_out" ? "check_out" : "check_in",
        kind: selection.kind,
        dayDate: selection.dayDate,
        dayLabel: label,
        room: null,
        session: null,
      },
    };
  }
  const rooms = await all<{ id: string; name: string }>(
    db,
    `SELECT id,name FROM (${publishedRoomsSql}) WHERE event_id=?`,
    [event.id],
  );
  const roomName = (id: string | null) => rooms.find((room) => room.id === id)?.name;
  let row: SessionRow | undefined;
  let roomId: string | null;
  if (selection.kind === "room") {
    roomId = selection.roomId;
    const name = roomName(roomId);
    if (!name) return { kind: "refused", reason: "invalid_code", target: null };
    const candidates = await all<SessionRow>(
      db,
      `SELECT ${sessionColumns} FROM (${publishedSessionsSql}) WHERE event_id=? AND start_at IS NOT NULL AND end_at IS NOT NULL
       AND start_at<=? AND end_at>? AND (room_id=? OR EXISTS(SELECT 1 FROM json_each(additional_room_ids_json) extra WHERE extra.value=?))
       ORDER BY start_at,id LIMIT 50`,
      [event.id, addMinutes(clock.now, ROOM_SESSION_LEAD_MINUTES), clock.now, roomId, roomId],
    );
    const resolved = resolveRoomSession(
      candidates.map((candidate) => ({
        ...candidate,
        startAt: candidate.start_at,
        endAt: candidate.end_at,
        roomIds: agendaOccurrenceRoomIds({
          roomId: candidate.room_id,
          additionalRoomIds: JSON.parse(candidate.additional_room_ids_json),
        }),
      })),
      roomId,
      clock.now,
      clock.timeZone,
    );
    if (resolved.state === "none")
      return {
        kind: "refused",
        reason: "no_session",
        target: {
          ...base,
          action: "check_in",
          kind: "room",
          dayDate: clock.today,
          dayLabel: dayLabel(clock.today) ?? clock.today,
          room: { id: roomId, name },
          session: null,
        },
      };
    row = resolved.session;
  } else {
    [row] = await all<SessionRow>(
      db,
      `SELECT ${sessionColumns} FROM (${publishedSessionsSql}) WHERE event_id=? AND id=? AND start_at IS NOT NULL AND end_at IS NOT NULL`,
      [event.id, selection.occurrenceId],
    );
    if (!row) return { kind: "refused", reason: "invalid_code", target: null };
    const sessionRooms = agendaOccurrenceRoomIds({
      roomId: row.room_id,
      additionalRoomIds: JSON.parse(row.additional_room_ids_json),
    });
    // A session in several rooms is not placed in one by its own code.
    roomId = sessionRooms.length === 1 ? sessionRooms[0]! : null;
  }
  const day = instantToCalendarDate(row.start_at, clock.timeZone);
  const room = roomId ? { id: roomId, name: roomName(roomId) ?? "" } : null;
  return {
    kind: "session",
    session: {
      id: row.id,
      roomId,
      day,
      window: sessionCheckInWindow({ startAt: row.start_at, endAt: row.end_at }, clock.now),
    },
    target: {
      ...base,
      action: "check_in",
      kind: selection.kind,
      dayDate: day,
      dayLabel: dayLabel(day) ?? day,
      room,
      session: { id: row.id, title: row.title, startAt: row.start_at, endAt: row.end_at, room },
    },
  };
}
