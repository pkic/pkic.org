import { agendaOccurrenceCalendarUid } from "../../../../assets/shared/event-agenda-calendar-identity";
import ICAL from "ical.js";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { publishedRoomsSql, publishedSessionsSql } from "./published-schedule";
/** Stable occurrence UIDs survive edits; sequence changes only when represented values change.
 * Physical LOCATION follows approved selected-room membership. Confirmed legacy
 * null-room allocations retain their canonical primary pool; an unallocated
 * multi-room preference is not assigned a room merely by generating a feed.
 */
export function preparePersonalCalendarEntries(db: DatabaseLike, eventId: string, userId?: string) {
  const owner = userId ? " AND p.user_id=?" : "";
  const values = userId ? [eventId, userId] : [eventId];
  const now = nowIso();
  return [
    db
      .prepare(
        `INSERT INTO agenda_calendar_entries(event_id,occurrence_id,user_id,sequence,revision,status,title,start_at,end_at,location,updated_at)
    SELECT p.event_id,p.occurrence_id,p.user_id,0,state.published_revision,
      CASE p.status WHEN 'reserved' THEN 'confirmed' WHEN 'canceled' THEN 'canceled' ELSE 'tentative' END,
      s.title,s.start_at,s.end_at,room.name,?
    FROM agenda_session_participations p JOIN (${publishedSessionsSql}) s ON s.id=p.occurrence_id AND s.event_id=p.event_id
    JOIN event_agenda_state state ON state.event_id=p.event_id
    LEFT JOIN (${publishedRoomsSql}) room ON room.event_id=s.event_id AND p.attendance_mode='physical'
      AND room.id=COALESCE(p.room_id,CASE WHEN p.status='reserved' OR json_array_length(s.additional_room_ids_json)=0 THEN s.room_id ELSE NULL END)
      AND (room.id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) placement WHERE placement.value=room.id))
    WHERE p.event_id=?${owner} AND (p.status<>'canceled' OR EXISTS(SELECT 1 FROM agenda_calendar_entries previous WHERE previous.event_id=p.event_id AND previous.occurrence_id=p.occurrence_id AND previous.user_id=p.user_id))
    ON CONFLICT(event_id,occurrence_id,user_id) DO UPDATE SET sequence=agenda_calendar_entries.sequence+1,
      revision=excluded.revision,status=excluded.status,title=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.title ELSE excluded.title END,start_at=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.start_at ELSE excluded.start_at END,end_at=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.end_at ELSE excluded.end_at END,location=CASE WHEN excluded.status='canceled' THEN agenda_calendar_entries.location ELSE excluded.location END,updated_at=excluded.updated_at
    WHERE agenda_calendar_entries.status<>excluded.status OR (excluded.status<>'canceled' AND (agenda_calendar_entries.title<>excluded.title
      OR agenda_calendar_entries.start_at IS NOT excluded.start_at OR agenda_calendar_entries.end_at IS NOT excluded.end_at OR agenda_calendar_entries.location IS NOT excluded.location))`,
      )
      .bind(now, ...values),
    db
      .prepare(
        `UPDATE agenda_calendar_entries AS entry SET status='canceled',sequence=sequence+1,updated_at=?
      WHERE event_id=? ${userId ? "AND user_id=?" : ""} AND status<>'canceled' AND NOT EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s WHERE s.id=entry.occurrence_id AND s.event_id=entry.event_id)`,
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
  const rows = await all<{
    occurrence_id: string;
    sequence: number;
    status: string;
    title: string;
    start_at: string | null;
    end_at: string | null;
    location: string | null;
    updated_at: string;
  }>(
    db,
    `SELECT occurrence_id,sequence,status,title,start_at,end_at,location,updated_at FROM agenda_calendar_entries
      WHERE event_id=? AND user_id=? AND (? IS NULL OR EXISTS(SELECT 1 FROM agenda_calendar_subscriptions sub JOIN users person ON person.id=sub.user_id WHERE sub.id=? AND sub.event_id=agenda_calendar_entries.event_id AND sub.user_id=agenda_calendar_entries.user_id AND sub.revoked_at IS NULL AND person.active=1)) AND (status='confirmed' OR status='canceled' AND updated_at>=? OR ?=1 AND status='tentative') ORDER BY start_at,occurrence_id`,
    [
      eventId,
      userId,
      subscriptionId ?? null,
      subscriptionId ?? null,
      new Date(Date.now() - 90 * 86400000).toISOString(),
      includeTentative ? 1 : 0,
    ],
  );
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
    event.addPropertyWithValue(
      "status",
      row.status === "canceled" ? "CANCELLED" : row.status === "tentative" ? "TENTATIVE" : "CONFIRMED",
    );
    if (row.location) event.addPropertyWithValue("location", row.location);
    calendar.addSubcomponent(event);
  }
  return calendar.toString();
}
