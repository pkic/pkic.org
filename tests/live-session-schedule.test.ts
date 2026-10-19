import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { readPublishedLiveAgenda } from "../functions/_lib/services/live-session/approved-agenda";
import { resolveLiveSchedule } from "../functions/_lib/services/live-session/room-schedule";
import { DEFAULT_LIVE_SCHEDULE_CONFIG } from "../assets/shared/schemas/live-session-schedule";
import { approvedAgendaSnapshot } from "./fixtures/approved-agenda";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
beforeEach(resetDb);
it("resolves only the requested event's approved revision despite a newer draft and other event publication", async () => {
  const { eventId, admin } = await seedEventAndAdmin(env.DB),
    foreign = crypto.randomUUID(),
    timestamp = new Date().toISOString();
  const approved = { ...approvedAgendaSnapshot, eventSlug: "pqc-2026" };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,99,3,?)",
    ).bind(eventId, timestamp),
    env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,3,?,?,?)",
    ).bind(crypto.randomUUID(), eventId, JSON.stringify(approved), admin.id, timestamp),
    env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,2,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      eventId,
      JSON.stringify({ ...approved, eventName: "Older approval" }),
      admin.id,
      timestamp,
    ),
    env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'foreign-live','Foreign','UTC','{}',?,?)",
    ).bind(foreign, timestamp, timestamp),
    env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,3,3,?)",
    ).bind(foreign, timestamp),
    env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,3,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      foreign,
      JSON.stringify({ ...approved, eventSlug: "foreign-live", eventName: "Foreign approval" }),
      admin.id,
      timestamp,
    ),
  ]);
  expect((await readPublishedLiveAgenda(env.DB, eventId))?.eventSlug).toBe("pqc-2026");
  expect(await readPublishedLiveAgenda(env.DB, crypto.randomUUID())).toBe(null);
  const result = await resolveLiveSchedule(
    env.DB,
    eventId,
    null,
    DEFAULT_LIVE_SCHEDULE_CONFIG,
    Date.parse("2026-12-01T08:30:00.000Z"),
  );
  expect(result?.rooms.map((room) => room.title)).toEqual(["Approved session"]);
  expect(JSON.stringify(result)).not.toContain("Foreign");
});
it("keeps missing and invalid approved payloads unavailable instead of falling back to a draft", async () => {
  const { eventId, admin } = await seedEventAndAdmin(env.DB),
    timestamp = new Date().toISOString();
  expect(await readPublishedLiveAgenda(env.DB, eventId)).toBe(null);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,9,3,?)",
    ).bind(eventId, timestamp),
    env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,3,'{}',?,?)",
    ).bind(crypto.randomUUID(), eventId, admin.id, timestamp),
  ]);
  expect(await resolveLiveSchedule(env.DB, eventId, null, DEFAULT_LIVE_SCHEDULE_CONFIG)).toMatchObject({
    available: false,
    timeZone: null,
    rooms: [],
  });
  expect(await resolveLiveSchedule(env.DB, eventId, null, null)).toBe(null);
});
