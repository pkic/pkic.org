import { agendaOccurrenceCalendarUid } from "../../../../assets/shared/event-agenda-calendar-identity";
import ICAL from "ical.js";
import { batchRows } from "../../db/pagination";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { D1StatementResult } from "../../types";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { publishedRoomsSql, publishedSessionsSql } from "./published-schedule";
/** Stable occurrence UIDs survive edits; sequence changes only when represented values change.
 * Physical LOCATION names the session's primary room: combined rooms are one pool and
 * staff direct any overflow on site, so an attendee is never placed in one room.
 *
 * Entry states: `confirmed` (a seat), `tentative` (starred, requested or waitlisted),
 * `canceled` (off the agenda), and `released` (a confirmed seat was released but the session
 * stays starred). A feed of confirmed sessions only emits `released` as a cancellation, so the
 * calendar drops the seat; a feed with tentative sessions keeps it as tentative.
 */
export function preparePersonalCalendarEntries(db: DatabaseLike, selection: EventReadSelection, userId?: string) {
  const event = eventReadIdSql(selection);
  const owner = userId ? " AND p.user_id=?" : "";
  const values = userId ? [...event.bindings, userId] : event.bindings;
  const now = nowIso();
  return [
    db
      .prepare(
        `INSERT INTO agenda_calendar_entries(event_id,occurrence_id,user_id,sequence,revision,status,title,start_at,end_at,location,updated_at)
    SELECT p.event_id,p.occurrence_id,p.user_id,0,state.published_revision,
      CASE WHEN p.status='reserved' THEN 'confirmed'
        WHEN p.status='canceled' AND p.saved=0 THEN 'canceled'
        WHEN p.status='canceled' AND previous.status IN ('confirmed','released','canceled') THEN 'released'
        ELSE 'tentative' END,
      s.title,s.start_at,s.end_at,room.name,?
    FROM agenda_session_participations p JOIN (${publishedSessionsSql}) s ON s.id=p.occurrence_id AND s.event_id=p.event_id
    JOIN event_agenda_state state ON state.event_id=p.event_id
    LEFT JOIN (${publishedRoomsSql}) room ON room.event_id=s.event_id AND p.attendance_mode='physical'
      AND room.id=s.room_id
    LEFT JOIN agenda_calendar_entries previous ON previous.event_id=p.event_id AND previous.occurrence_id=p.occurrence_id AND previous.user_id=p.user_id
    WHERE p.event_id=${event.sql}${owner} AND (p.status<>'canceled' OR p.saved=1 OR previous.status IS NOT NULL)
    ON CONFLICT(event_id,occurrence_id,user_id) DO UPDATE SET sequence=agenda_calendar_entries.sequence+1,
      revision=excluded.revision,status=excluded.status,title=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.title ELSE excluded.title END,start_at=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.start_at ELSE excluded.start_at END,end_at=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.end_at ELSE excluded.end_at END,location=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.location ELSE excluded.location END,updated_at=excluded.updated_at
    WHERE agenda_calendar_entries.status<>excluded.status OR (excluded.status<>'canceled' AND (agenda_calendar_entries.title<>excluded.title
      OR agenda_calendar_entries.start_at IS NOT excluded.start_at OR agenda_calendar_entries.end_at IS NOT excluded.end_at OR agenda_calendar_entries.location IS NOT excluded.location))`,
      )
      .bind(now, ...values),
    db
      .prepare(
        `UPDATE agenda_calendar_entries AS entry SET status='canceled',sequence=sequence+1,updated_at=?
      WHERE event_id=${event.sql} ${userId ? "AND user_id=?" : ""} AND status<>'canceled' AND NOT EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s WHERE s.id=entry.occurrence_id AND s.event_id=entry.event_id)`,
      )
      .bind(now, ...values),
  ];
}
export async function personalAgendaCalendar(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  includeTentative: boolean,
  subscriptionId?: string,
) {
  const owner = {
    sql: `SELECT ? AS user_id,? AS include_tentative WHERE (? IS NULL OR EXISTS(SELECT 1 FROM agenda_calendar_subscriptions sub JOIN users person ON person.id=sub.user_id WHERE sub.id=? AND sub.event_id=? AND sub.user_id=? AND sub.revoked_at IS NULL AND person.active=1))`,
    bindings: [userId, includeTentative ? 1 : 0, subscriptionId ?? null, subscriptionId ?? null, eventId, userId],
  };
  const read = preparePersonalCalendarRead(db, eventId, owner);
  return read.decode(await db.batch(read.statements));
}

/** Trusted backend owner query; subscription callers include active-person and revocation checks. */
export interface CalendarFeedOwnerSelection {
  sql: string;
  bindings: readonly unknown[];
}
interface CalendarEntryRow {
  occurrence_id: string;
  sequence: number;
  status: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  updated_at: string;
  include_tentative: number;
}

export function preparePersonalCalendarRead(
  db: DatabaseLike,
  eventSelection: EventReadSelection,
  owner: CalendarFeedOwnerSelection,
) {
  const event = eventReadIdSql(eventSelection);
  return {
    statements: [
      db
        .prepare(`WITH scope AS(SELECT ${event.sql} AS event_id),owner AS(${owner.sql})
      SELECT entry.occurrence_id,entry.sequence,entry.status,entry.title,entry.start_at,entry.end_at,entry.location,entry.updated_at,owner.include_tentative
      FROM agenda_calendar_entries entry CROSS JOIN scope JOIN owner ON owner.user_id=entry.user_id
      WHERE entry.event_id=scope.event_id AND (entry.status='confirmed' OR (entry.status='canceled' OR owner.include_tentative=0 AND entry.status='released') AND entry.updated_at>=? OR owner.include_tentative=1 AND entry.status IN ('tentative','released')) ORDER BY entry.start_at,entry.occurrence_id`)
        .bind(...event.bindings, ...owner.bindings, new Date(Date.now() - 90 * 86400000).toISOString()),
    ],
    decode: (loaded: D1StatementResult[]) => serializePersonalCalendar(batchRows<CalendarEntryRow>(loaded[0])),
  };
}

function serializePersonalCalendar(rows: CalendarEntryRow[]) {
  const feedStatus = (status: string, includeTentative: boolean) =>
    status === "canceled" || (status === "released" && !includeTentative)
      ? "CANCELLED"
      : status === "confirmed"
        ? "CONFIRMED"
        : "TENTATIVE";
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//PKI Consortium//Personal Agenda//EN");
  calendar.addPropertyWithValue("calscale", "GREGORIAN");
  calendar.addPropertyWithValue("method", "PUBLISH");
  for (const row of rows) {
    if (!row.start_at || !row.end_at) continue;
    const event = new ICAL.Component("vevent");
    event.addPropertyWithValue("uid", agendaOccurrenceCalendarUid(row.occurrence_id));
    event.addPropertyWithValue("sequence", row.sequence);
    event.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(row.updated_at), true));
    event.addPropertyWithValue("dtstart", ICAL.Time.fromJSDate(new Date(row.start_at), true));
    event.addPropertyWithValue("dtend", ICAL.Time.fromJSDate(new Date(row.end_at), true));
    event.addPropertyWithValue("summary", row.title);
    event.addPropertyWithValue("status", feedStatus(row.status, row.include_tentative === 1));
    if (row.location) event.addPropertyWithValue("location", row.location);
    calendar.addSubcomponent(event);
  }
  return calendar.toString();
}
