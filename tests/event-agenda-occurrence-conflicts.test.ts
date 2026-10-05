import { seedStaffingPositionAssignment } from "./helpers/agenda-staffing";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { listAgendaOccurrences, getAgendaOccurrence } from "../functions/_lib/services/event-agenda/read";
import { agendaOccurrenceQuerySchema, agendaOccurrenceListSchema } from "../assets/shared/schemas/event-agenda";
let eventId: string, userId: string, roomA: string, roomB: string, token: string;
async function occurrence(
  title: string,
  start: string | null,
  end: string | null,
  room: string | null = roomA,
  event = eventId,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id) VALUES(?,?,?,?,?,?)",
  )
    .bind(id, event, title, start, end, room)
    .run();
  return id;
}
const time = (hour: number, minute = 0) =>
  `2026-12-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
async function list(query: Record<string, unknown> = {}) {
  return listAgendaOccurrences(env.DB, eventId, agendaOccurrenceQuerySchema.parse({ limit: 100, ...query }));
}
describe("Bounded canonical session conflict indicators", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
    token = await createAdminSession(env.DB, userId, crypto.randomUUID());
    roomA = crypto.randomUUID();
    roomB = crypto.randomUUID();
    for (const [id, name] of [
      [roomA, "Room A"],
      [roomB, "Room B"],
    ])
      await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name) VALUES(?,?,?)")
        .bind(id, eventId, name)
        .run();
  });
  it("recognizes additional-room overlap but excludes adjacent half-open sessions", async () => {
    const first = await occurrence("First", time(9), time(10));
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
      .bind(first, roomB)
      .run();
    const overlapping = await occurrence("Parallel", time(9, 30), time(10, 30), roomB);
    const adjacent = await occurrence("Adjacent", time(10, 30), time(11), roomB);
    const result = await list();
    expect(result.occurrences.find((item) => item.id === first)?.conflicts.categories).toEqual(["room_overlap"]);
    expect(result.occurrences.find((item) => item.id === overlapping)?.conflicts.hasConflict).toBe(true);
    expect(result.occurrences.find((item) => item.id === adjacent)?.conflicts.hasConflict).toBe(false);
    expect(await getAgendaOccurrence(env.DB, eventId, first)).not.toHaveProperty("conflicts");
  });
  it("flags insufficient setup and room availability, respecting exact setup boundaries", async () => {
    await env.DB.prepare("UPDATE event_agenda_rooms SET setup_minutes=10 WHERE id=?").bind(roomA).run();
    await occurrence("First", time(9), time(10));
    const exact = await occurrence("Exact setup", time(10, 10), time(11));
    expect((await list()).occurrences.find((item) => item.id === exact)?.conflicts.hasConflict).toBe(false);
    await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=? WHERE id=?").bind(time(10, 9), exact).run();
    expect((await list()).occurrences.find((item) => item.id === exact)?.conflicts.categories).toContain("room_setup");
    await env.DB.prepare("UPDATE event_agenda_rooms SET available_periods_json=? WHERE id=?")
      .bind(JSON.stringify([{ startAt: time(9), endAt: time(11) }]), roomA)
      .run();
    expect((await list()).occurrences.find((item) => item.id === exact)?.conflicts.categories).toContain(
      "room_unavailable",
    );
  });
  it("checks canonical speaker availability across events without exposing foreign event details", async () => {
    const local = await occurrence("Local", time(9), time(10));
    const foreignEvent = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,?,'Confidential event','UTC','invite_or_open','{}',?,?)",
    )
      .bind(foreignEvent, foreignEvent, time(8), time(8))
      .run();
    const foreign = await occurrence("Confidential title", time(9, 30), time(10, 30), null, foreignEvent);
    for (const id of [local, foreign])
      await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
        .bind(id, userId)
        .run();
    const result = await list();
    expect(result.occurrences[0].conflicts.categories).toContain("speaker_conflict");
    expect(JSON.stringify(result)).not.toContain("Confidential");
    expect(JSON.stringify(result)).not.toContain(foreignEvent);
    expect(JSON.stringify(result)).not.toContain(foreign);
  });
  it("uses staffing conflict predicates for speakers and preserves travel buffers", async () => {
    const local = await occurrence("Talk", time(9), time(10));
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
      .bind(local, userId)
      .run();
    const block = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_agenda_blocks(id,event_id,name,start_at,end_at,room_id,roles_json) VALUES(?,?,'Duty',?,?,?,'[\"mc\"]')",
    )
      .bind(block, eventId, time(10), time(11), roomB)
      .run();
    await seedStaffingPositionAssignment(env.DB, { eventId, blockId: block, role: "mc", userId });
    expect((await list()).occurrences[0].conflicts.hasConflict).toBe(false);
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,travel_minutes,updated_at) VALUES(?,10,?) ON CONFLICT(event_id) DO UPDATE SET travel_minutes=10",
    )
      .bind(eventId, time(8))
      .run();
    expect((await list()).occurrences[0].conflicts.categories).toContain("speaker_duty_conflict");
  });
  it("includes indexed meeting speaker intervals without leaking meeting content", async () => {
    const local = await occurrence("Talk", time(9), time(10));
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
      .bind(local, userId)
      .run();
    const series = crypto.randomUUID(),
      meeting = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_series(id,event_id,starts_at,recurrence_rule,timezone,duration_minutes,created_at,updated_at) VALUES(?,?,?,'FREQ=WEEKLY','UTC',60,?,?)",
    )
      .bind(series, eventId, time(9), time(8), time(8))
      .run();
    await env.DB.prepare(
      "INSERT INTO event_occurrences(id,series_id,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(meeting, series, time(9), time(10), time(8), time(8))
      .run();
    await env.DB.prepare(
      "INSERT INTO meeting_agenda_speaker_intervals(event_id,occurrence_id,item_id,user_id,start_at,end_at,room_id) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(eventId, meeting, crypto.randomUUID(), userId, time(9, 30), time(10), roomB)
      .run();
    const result = await list();
    expect(result.occurrences[0].conflicts.categories).toContain("speaker_meeting_conflict");
    expect(JSON.stringify(result)).not.toContain(meeting);
  });
  it("mounted filters count the full population before pagination and distinguish unverified unscheduled sessions from clear intervals", async () => {
    await occurrence("First", time(9), time(10));
    await occurrence("Second", time(9, 30), time(10, 30));
    const unscheduled = await occurrence("Unscheduled", null, null, null);
    const response = await callApi(env, "/api/v1/events/pqc-2026/agenda/occurrences?conflict=conflicted&limit=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const result = agendaOccurrenceListSchema.parse(await response.json());
    expect(result.occurrences).toHaveLength(1);
    expect(result.page.total).toBe(2);
    const clear = await list({ conflict: "clear" });
    expect(clear.occurrences).toEqual([]);
    expect(clear.page.total).toBe(0);
    const incomplete = await list({ conflict: "incomplete" });
    expect(incomplete.occurrences.map((item) => item.id)).toEqual([unscheduled]);
    expect(incomplete.occurrences[0].conflicts.coverage).toBe("not_scheduled");
  });
  it("orders and day-filters historical starts without inventing a schedulable ending or verified credit coverage", async () => {
    const first = await occurrence("Earlier", time(9), time(10));
    const archived = await occurrence("Archived networking", null, null, null);
    const last = await occurrence("Later", time(16), time(17));
    await env.DB.prepare(
      "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
    )
      .bind(
        archived,
        JSON.stringify({
          archivalTiming: {
            startAt: time(15, 30),
            endAt: null,
            sourcePath: "data/events/archive.yaml",
            sourceDigest: "a".repeat(64),
            provenance: "authored_public",
            timeZone: "Europe/Amsterdam",
            authoredDate: "2026-12-01",
            authoredStart: "16:30",
          },
          archivalCredits: [
            {
              sourceRef: "legacy-person",
              role: "speaker",
              sourcePath: "data/events/archive.yaml",
              sourceDigest: "b".repeat(64),
              provenance: "authored_public",
              displayName: "Historical speaker",
              jobTitle: null,
              organizationName: null,
              photoUrl: null,
            },
          ],
        }),
        userId,
        time(8),
      )
      .run();
    const ordered = await list({ sort: "startAt", limit: 2 });
    expect(ordered.occurrences.map((item) => item.id)).toEqual([first, archived]);
    expect(ordered.page.total).toBe(3);
    expect(ordered.occurrences[1]).toMatchObject({
      startAt: null,
      endAt: null,
      history: { archivalTiming: { startAt: time(15, 30), endAt: null } },
      conflicts: { hasConflict: false, coverage: "incomplete" },
    });
    const reverse = await list({ sort: "-startAt", limit: 1 });
    expect(reverse.occurrences[0].id).toBe(last);
    const day = await list({ day: "2026-12-01" });
    expect(day.occurrences.map((item) => item.id)).toEqual([first, archived, last]);
    expect((await list({ day: "2026-12-02" })).page.total).toBe(0);
    expect((await list({ conflict: "clear" })).occurrences.map((item) => item.id)).toEqual([first, last]);
    expect((await list({ conflict: "incomplete" })).occurrences.map((item) => item.id)).toEqual([archived]);
  });
});
