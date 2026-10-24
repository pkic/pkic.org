import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import { agendaCalendarCurrentSubscriptionSchema } from "../assets/shared/schemas/event-agenda-calendar";
import {
  revokeAgendaCalendarSubscriptions,
  rotateAgendaCalendarSubscription,
} from "../functions/_lib/services/event-participation/calendar-subscriptions";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import { callApi } from "./helpers/app";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
beforeEach(() => f.setup());

function agenda(query: string, token = f.tokens.attendee) {
  return callApi(
    env,
    `/api/v1/events/${f.eventSlug}/agenda/participation?${query}`,
    { headers: { authorization: `Bearer ${token}` } },
    { maxRoundTrips: 1 },
  );
}

describe("complete participant read budgets", () => {
  const read = (path: string, token = f.tokens.attendee) =>
    callApi(
      env,
      `/api/v1/events/${f.eventSlug}${path}`,
      { headers: { authorization: `Bearer ${token}` } },
      { maxRoundTrips: 1 },
    );
  it("loads both attendee-home windows and the personal page in one call each", async () => {
    await setSessionParticipation(env.DB, f.eventId, f.occurrenceId, f.users.attendee, {
      action: "save",
      attendanceMode: "physical",
    });
    const from = encodeURIComponent(new Date().toISOString());
    for (const query of [
      `from=${from}&sort=startAt&limit=5`,
      `from=${from}&mine=true&sort=startAt&limit=1`,
      "sort=startAt&limit=10",
    ]) {
      const response = await agenda(query);
      expect(response.status).toBe(200);
      const body = personalAgendaResponseSchema.parse(await response.json());
      expect(body.sessions.map((session) => session.id)).toContain(f.occurrenceId);
    }
  });

  it("returns an empty personal window in one call", async () => {
    const response = await agenda("mine=true&limit=1");
    expect(response.status).toBe(200);
    expect(personalAgendaResponseSchema.parse(await response.json()).sessions).toEqual([]);
  });

  it.each(["revoked", "inactive"] as const)("refuses a %s session before releasing resource data", async (state) => {
    if (state === "revoked")
      await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
        .bind(new Date().toISOString(), f.users.attendee)
        .run();
    else await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.users.attendee).run();
    expect((await agenda("limit=1")).status).toBe(401);
    for (const path of [
      "/calendar/settings",
      "/calendar/subscriptions/current",
      `/agenda/occurrences/${f.occurrenceId}/virtual-room`,
    ])
      expect((await read(path)).status).toBe(401);
  });

  it("reads calendar settings and the owner's current link in one call each", async () => {
    expect((await read("/calendar/settings")).status).toBe(200);
    const missing = await read("/calendar/subscriptions/current");
    expect(missing.status).toBe(200);
    expect(agendaCalendarCurrentSubscriptionSchema.parse(await missing.json())).toMatchObject({ active: false });
    const subscription = await rotateAgendaCalendarSubscription(
      env.DB,
      f.eventId,
      f.users.attendee,
      { baseUrl: "https://app.test", eventSlug: f.eventSlug, signingSecret: env.INTERNAL_SIGNING_SECRET },
      { includeTentative: true, reminderEnabled: false, reminderMinutes: 10 },
    );
    const current = await read("/calendar/subscriptions/current");
    expect(current.status).toBe(200);
    expect(agendaCalendarCurrentSubscriptionSchema.parse(await current.json()).subscription?.url).toBe(
      subscription.url,
    );
    const other = await read("/calendar/subscriptions/current", f.tokens.secondAttendee);
    expect(agendaCalendarCurrentSubscriptionSchema.parse(await other.json()).active).toBe(false);
  });

  it.each(["revoked", "inactive"] as const)("serves a token feed in one call and refuses it once %s", async (state) => {
    await setSessionParticipation(env.DB, f.eventId, f.occurrenceId, f.users.attendee, {
      action: "save",
      attendanceMode: "physical",
    });
    const subscription = await rotateAgendaCalendarSubscription(
      env.DB,
      f.eventId,
      f.users.attendee,
      { baseUrl: "https://app.test", eventSlug: f.eventSlug, signingSecret: env.INTERNAL_SIGNING_SECRET },
      { includeTentative: true, reminderEnabled: false, reminderMinutes: 10 },
    );
    const url = new URL(subscription.url);
    const response = await callApi(env, url.pathname, undefined, { maxRoundTrips: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain(f.occurrenceId);
    if (state === "revoked") await revokeAgendaCalendarSubscriptions(env.DB, f.eventId, f.users.attendee);
    else await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.users.attendee).run();
    const refused = await callApi(env, url.pathname, undefined, { maxRoundTrips: 1 });
    expect(refused.status).toBe(404);
    expect(await refused.text()).not.toContain(f.occurrenceId);
  });

  it("refuses unknown feed tokens and scopes them to their owning event in one call", async () => {
    const missing = await callApi(
      env,
      `/api/v1/events/${f.eventSlug}/calendar/subscriptions/${"a".repeat(64)}/calendar.ics`,
      undefined,
      { maxRoundTrips: 1 },
    );
    expect(missing.status).toBe(404);
    const subscription = await rotateAgendaCalendarSubscription(
      env.DB,
      f.eventId,
      f.users.attendee,
      { baseUrl: "https://app.test", eventSlug: f.eventSlug, signingSecret: env.INTERNAL_SIGNING_SECRET },
      { includeTentative: true, reminderEnabled: false, reminderMinutes: 10 },
    );
    const otherSlug = "unrelated-calendar-event";
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,source_path,registration_mode,settings_json,created_at,updated_at) SELECT ?,?,'Other calendar event',timezone,source_path,registration_mode,settings_json,created_at,updated_at FROM events WHERE id=?",
    )
      .bind(crypto.randomUUID(), otherSlug, f.eventId)
      .run();
    const wrongEvent = new URL(subscription.url).pathname.replace(`/events/${f.eventSlug}/`, `/events/${otherSlug}/`);
    const refused = await callApi(env, wrongEvent, undefined, { maxRoundTrips: 1 });
    expect(refused.status).toBe(404);
    expect(await refused.text()).not.toContain(f.occurrenceId);
  });

  it.each([
    ["Pacific/Kiritimati", "2026-10-23T12:30:00.000Z", "2026-10-24"],
    ["America/Los_Angeles", "2026-10-23T01:30:00.000Z", "2026-10-22"],
    ["Europe/Amsterdam", "2026-10-25T00:30:00.000Z", "2026-10-25"],
    ["Europe/Amsterdam", "2026-10-25T01:30:00.000Z", "2026-10-25"],
  ])("uses the registered local day in %s for %s within the one-call read", async (zone, startAt, dayDate) => {
    const row = await env.DB.prepare("SELECT revision,snapshot_json FROM event_agenda_publications WHERE event_id=?")
      .bind(f.eventId)
      .first<{ revision: number; snapshot_json: string }>();
    const snapshot = JSON.parse(row!.snapshot_json);
    snapshot.timeZone = zone;
    const occurrence = snapshot.occurrences.find((session: { id: string }) => session.id === f.occurrenceId);
    occurrence.startAt = startAt;
    occurrence.endAt = new Date(Date.parse(startAt) + 3_600_000).toISOString();
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=?")
      .bind(JSON.stringify(snapshot), f.eventId, row!.revision)
      .run();
    await env.DB.prepare("UPDATE events SET timezone=? WHERE id=?").bind(zone, f.eventId).run();
    const now = new Date().toISOString(),
      dayId = crypto.randomUUID();
    // A nearby day has a different mode; the selected local day must not inherit its attendance.
    const adjacentId = crypto.randomUUID();
    const adjacentDate = new Date(Date.parse(`${dayDate}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,?,?)")
      .bind(adjacentId, f.eventId, adjacentDate, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) SELECT ?,id,?,'in_person',?,? FROM registrations WHERE event_id=? AND user_id=?",
    )
      .bind(crypto.randomUUID(), adjacentId, now, now, f.eventId, f.users.attendee)
      .run();
    await env.DB.prepare("INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,?,?)")
      .bind(dayId, f.eventId, dayDate, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) SELECT ?,id,?,'virtual',?,? FROM registrations WHERE event_id=? AND user_id=?",
    )
      .bind(crypto.randomUUID(), dayId, now, now, f.eventId, f.users.attendee)
      .run();
    const response = await agenda("limit=1");
    expect(response.status).toBe(200);
    const session = personalAgendaResponseSchema.parse(await response.json()).sessions[0]!;
    expect(session.availability?.attendanceMode).toBe("remote");
    await env.DB.prepare("DELETE FROM registration_day_attendance WHERE event_day_id=?").bind(dayId).run();
    const absent = await agenda("limit=1");
    expect(personalAgendaResponseSchema.parse(await absent.json()).sessions[0]!.availability?.state).toBe("wrong_mode");
  });

  it("preserves event visibility and does not expose another participant's private agenda", async () => {
    await env.DB.prepare("UPDATE events SET visibility='invitation_only' WHERE id=?").bind(f.eventId).run();
    await env.DB.prepare("DELETE FROM registrations WHERE event_id=? AND user_id=?")
      .bind(f.eventId, f.users.outsider)
      .run();
    expect((await agenda("limit=1", f.tokens.outsider)).status).toBe(404);
  });
});
