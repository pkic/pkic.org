import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import ICAL from "ical.js";
import { resetDb } from "./helpers/reset-db";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import {
  preparePersonalCalendarEntries,
  personalAgendaCalendar,
} from "../functions/_lib/services/event-participation/calendar-entries";
const eventId = crypto.randomUUID(),
  userId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  primaryRoom = crypto.randomUUID(),
  additionalRoom = crypto.randomUUID(),
  unassignedRoom = crypto.randomUUID();
async function entry(includeTentative = false) {
  const calendar = new ICAL.Component(
    ICAL.parse(await personalAgendaCalendar(env.DB, eventId, userId, includeTentative)),
  );
  return calendar.getFirstSubcomponent("vevent")!;
}
describe("Personal calendar physical allocation location", () => {
  beforeEach(async () => {
    await resetDb();
    const now = new Date().toISOString(),
      start = new Date(Date.now() + 3600000).toISOString(),
      end = new Date(Date.now() + 7200000).toISOString();
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(userId, `${userId}@example.test`, `${userId}@example.test`)
      .run();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'calendar-location','Calendar location','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), now, now)
      .run();
    for (const [id, name] of [
      [primaryRoom, "Primary room"],
      [additionalRoom, "Additional room"],
      [unassignedRoom, "Unassigned room"],
    ])
      await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,10)")
        .bind(id, eventId, name)
        .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,room_id,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Multi-room session',?,?,?,'reservation',10)",
    )
      .bind(sessionId, eventId, primaryRoom, start, end)
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
      .bind(sessionId, additionalRoom)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "calendar-location");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), userId, now)
      .run();
  });
  it("names the published primary room for a seat in combined rooms, and keeps one sequence across regeneration", async () => {
    // The registration attends the session's day in person, so the seat is physical without choosing a room.
    await setSessionParticipation(env.DB, eventId, sessionId, userId, { action: "reserve" });
    const before = await entry();
    expect(before.getFirstPropertyValue("location")).toBe("Primary room");
    expect(before.getFirstPropertyValue("sequence")).toBe(0);
    await env.DB.batch(preparePersonalCalendarEntries(env.DB, eventId, userId));
    expect((await entry()).getFirstPropertyValue("sequence")).toBe(0);
    await env.DB.prepare("UPDATE event_agenda_rooms SET name='Unpublished draft room name' WHERE id=?")
      .bind(primaryRoom)
      .run();
    await env.DB.batch(preparePersonalCalendarEntries(env.DB, eventId, userId));
    expect((await entry()).getFirstPropertyValue("location")).toBe("Primary room");
    expect((await entry()).getFirstPropertyValue("sequence")).toBe(0);
  });
  it("never projects a room for a remote seat, while a starred session shows where it takes place", async () => {
    await setSessionParticipation(env.DB, eventId, sessionId, userId, { action: "reserve" });
    await env.DB.prepare(
      "UPDATE agenda_session_participations SET attendance_mode='remote' WHERE occurrence_id=? AND user_id=?",
    )
      .bind(sessionId, userId)
      .run();
    await env.DB.batch(preparePersonalCalendarEntries(env.DB, eventId, userId));
    expect((await entry()).getFirstPropertyValue("location")).toBeNull();
    await env.DB.prepare(
      "UPDATE agenda_session_participations SET attendance_mode='physical',status='saved' WHERE occurrence_id=? AND user_id=?",
    )
      .bind(sessionId, userId)
      .run();
    await env.DB.batch(preparePersonalCalendarEntries(env.DB, eventId, userId));
    expect((await entry(true)).getFirstPropertyValue("location")).toBe("Primary room");
  });
});
