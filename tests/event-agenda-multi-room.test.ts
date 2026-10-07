import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { patchAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { issueBadge, recordScan } from "../functions/_lib/services/event-participation/scanning";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import { physicalOccupiedSql } from "../functions/_lib/services/event-participation/capacity-accounting";
import { offlineEligibility } from "../functions/_lib/services/event-participation/offline-eligibility";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
import { agendaRoomsListSchema } from "../assets/shared/schemas/event-agenda-room-list";
import { agendaBlocksListSchema } from "../assets/shared/schemas/event-agenda-block-list";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
let eventId: string, operatorId: string, occurrenceId: string, rooms: string[], users: string[], badges: string[];
async function foreignAgendaEvent() {
  const foreign = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,?,'Foreign','UTC','invite_or_open','{}',?,?)",
  )
    .bind(foreign, foreign, now, now)
    .run();
  return foreign;
}
async function scan(user: number, roomId: string | null, extra: Record<string, unknown> = {}) {
  return recordScan(
    env.DB,
    eventId,
    { operatorUserId: operatorId, canScan: true, canAdmitExceptions: true },
    eventScanRequestSchema.parse({
      operatorUserId: operatorId,
      operationId: crypto.randomUUID(),
      deviceId: operatorId,
      badgeId: badges[user],
      occurrenceId,
      roomId,
      action: "attendance",
      observedAt: new Date().toISOString(),
      ...extra,
    }),
  );
}
async function approvedCapacity(capacity: number, admissionPolicy?: "preference" | "reservation") {
  const p = await env.DB.prepare("SELECT id,snapshot_json FROM event_agenda_publications WHERE event_id=?")
    .bind(eventId)
    .first<{ id: string; snapshot_json: string }>();
  const snapshot = JSON.parse(p!.snapshot_json);
  snapshot.occurrences[0].capacity = capacity;
  if (admissionPolicy) snapshot.occurrences[0].admissionPolicy = admissionPolicy;
  await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE id=?")
    .bind(JSON.stringify(snapshot), p!.id)
    .run();
}
describe("Multi-room registration and advisory scan reporting", () => {
  beforeEach(async () => {
    await resetDb();
    eventId = crypto.randomUUID();
    operatorId = crypto.randomUUID();
    occurrenceId = crypto.randomUUID();
    rooms = [crypto.randomUUID(), crypto.randomUUID()];
    users = [crypto.randomUUID(), crypto.randomUUID()];
    badges = [];
    const now = new Date().toISOString();
    for (const id of [operatorId, ...users])
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await grantAdministrator(env.DB, operatorId);
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'multi-room-test','Multi room','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    for (let i = 0; i < rooms.length; i++)
      await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,1)")
        .bind(rooms[i], eventId, i ? "Overflow" : "Primary")
        .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id,capacity,admission_policy) VALUES(?,?,'Shared talk',?,?,?,2,'preference')",
    )
      .bind(occurrenceId, eventId, now, new Date(Date.now() + 60 * 60_000).toISOString(), rooms[0])
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
      .bind(occurrenceId, rooms[1])
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "multi-room-test");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, now)
      .run();
    for (const user of users) {
      await env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, user, crypto.randomUUID(), now, now)
        .run();
      badges.push(
        (await issueBadge(env.DB, eventId, operatorId, { userId: user, operationId: crypto.randomUUID() })).credential!,
      );
    }
  });
  it("lists only this event's locations with literal search, stable pages and unlimited capacity", async () => {
    const ids = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
    ];
    for (const [index, name] of ["Synthetic% Alpha", "Synthetic% Beta", "Synthetic% Gamma"].entries())
      await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,?)")
        .bind(ids[index], eventId, name, index === 0 ? null : 5)
        .run();
    const foreign = await foreignAgendaEvent();
    await env.DB.prepare(
      "INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Synthetic% Foreign',99)",
    )
      .bind(crypto.randomUUID(), foreign)
      .run();
    const token = await createAdminSession(env.DB, operatorId, crypto.randomUUID());
    const read = async (query: Record<string, string>) => {
      const response = await callApi(
        env,
        `/api/v1/events/multi-room-test/agenda/rooms?${new URLSearchParams({ q: "synthetic%", ...query })}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      return agendaRoomsListSchema.parse(await response.json());
    };
    const first = await read({ sort: "name", limit: "1" });
    expect(first.rooms).toMatchObject([{ id: ids[0], capacity: null }]);
    expect(first.page).toEqual({ limit: 1, offset: 0, total: 3, hasMore: true });
    const second = await read({ sort: "-capacity", limit: "1", offset: "1" });
    expect(second.rooms.map((room) => room.id)).toEqual([ids[2]]);
    const unlimited = await read({ sort: "capacity", limit: "1", offset: "2" });
    expect(unlimited.rooms[0]).toMatchObject({ id: ids[0], capacity: null });
    const empty = await read({ limit: "1", offset: "3" });
    expect(empty.rooms).toEqual([]);
    expect(empty.page).toMatchObject({ total: 3, hasMore: false });
    expect((await read({ q: "' OR 1=1 --" })).rooms).toEqual([]);
    expect(
      (
        await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?")
          .bind(eventId)
          .first<{ revision: number }>()
      )?.revision,
    ).toBe(0);
  });

  it("lists canonical staffing block configuration with paginated search, time sorting and room scope", async () => {
    const blockIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, name] of ["Morning staffing", "Afternoon staffing", "Evening staffing"].entries())
      await env.DB.prepare(
        "INSERT INTO event_agenda_blocks(id,event_id,name,start_at,end_at,room_id,roles_json) VALUES(?,?,?,?,?,?,'[]')",
      )
        .bind(
          blockIds[index],
          eventId,
          name,
          `2026-12-01T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
          `2026-12-01T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
          index === 0 ? rooms[0] : rooms[1],
        )
        .run();
    const foreign = await foreignAgendaEvent();
    await env.DB.prepare(
      "INSERT INTO event_agenda_blocks(id,event_id,name,start_at,end_at,roles_json) VALUES(?,?,'Foreign staffing','2026-12-01T09:00:00.000Z','2026-12-01T10:00:00.000Z','[]')",
    )
      .bind(crypto.randomUUID(), foreign)
      .run();
    const token = await createAdminSession(env.DB, operatorId, crypto.randomUUID());
    const read = async (query: Record<string, string>) => {
      const response = await callApi(
        env,
        `/api/v1/events/multi-room-test/agenda/blocks?${new URLSearchParams(query)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
      return agendaBlocksListSchema.parse(await response.json());
    };
    const page = await read({ q: "STAFFING", sort: "-startAt", limit: "1", offset: "1", roomId: rooms[1]! });
    expect(page.blocks.map((block) => block.id)).toEqual([blockIds[1]]);
    expect(page.blocks[0]).toMatchObject({
      roomId: rooms[1],
      roles: [],
      roleRequirements: [],
      compatibleRolePairs: [],
      boundaries: {},
    });
    expect(page.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect((await read({ q: "staffing" })).page.total).toBe(3);
    expect((await read({ q: "staffing", roomId: crypto.randomUUID() })).page.total).toBe(0);
    expect((await read({ q: "' OR 1=1 --" })).blocks).toEqual([]);
  });

  it("requires live exact-event agenda read authority and canonical queries for both lists", async () => {
    const now = new Date().toISOString();
    const foreign = await foreignAgendaEvent();
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
    )
      .bind(grantId, users[0], foreign, now)
      .run();
    const token = await createAdminSession(env.DB, users[0]!, crypto.randomUUID());
    const headers = { authorization: `Bearer ${token}` };
    for (const collection of ["rooms", "blocks"]) {
      const path = `/api/v1/events/multi-room-test/agenda/${collection}`;
      expect((await callApi(env, path)).status).toBe(401);
      expect((await callApi(env, path, { headers })).status).toBe(403);
      expect((await callApi(env, `/api/v1/events/${foreign}/agenda/${collection}`, { headers })).status).toBe(200);
    }
    await env.DB.prepare("UPDATE permission_grants SET context_id=? WHERE id=?").bind(eventId, grantId).run();
    for (const collection of ["rooms", "blocks"]) {
      const path = `/api/v1/events/multi-room-test/agenda/${collection}`;
      expect((await callApi(env, `${path}?sort=not_a_column`, { headers })).status).toBe(400);
      expect((await callApi(env, `${path}?limit=201`, { headers })).status).toBe(400);
      expect((await callApi(env, path, { headers })).status).toBe(200);
    }
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(now, users[0]).run();
    for (const collection of ["rooms", "blocks"])
      expect((await callApi(env, `/api/v1/events/multi-room-test/agenda/${collection}`, { headers })).status).toBe(401);
  });
  it("reports missing room context and records valid scans without consuming room places", async () => {
    expect(await scan(0, null)).toMatchObject({
      recorded: true,
      outcome: "warning",
      reason: "wrong_location",
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    for (const user of [0, 1])
      expect(await scan(user, rooms[0])).toMatchObject({
        outcome: "eligible",
        attendanceRecorded: true,
        admissionRecorded: false,
      });
    expect(await scan(0, rooms[1])).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions").first()).toEqual({
      total: 0,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 4,
    });
    expect(
      await env.DB.prepare(
        `WITH target AS(SELECT ? AS id) SELECT ${physicalOccupiedSql("target.id")} AS occupied FROM target`,
      )
        .bind(occurrenceId)
        .first("occupied"),
    ).toBe(0);
    await patchAgendaOccurrence(env.DB, eventId, "multi-room-test", occurrenceId, {
      expectedRevision: 0,
      capacity: 1,
      additionalRoomIds: [],
    });
    expect((await getAgenda(env.DB, eventId, "multi-room-test")).occurrences[0].additionalRoomIds).toEqual([]);
  });
  it("enforces actual reservation limits per room and per session while scans remain advisory", async () => {
    const publication = await env.DB.prepare("SELECT id,snapshot_json FROM event_agenda_publications WHERE event_id=?")
      .bind(eventId)
      .first<{ id: string; snapshot_json: string }>();
    const snapshot = JSON.parse(publication!.snapshot_json);
    snapshot.occurrences[0].admissionPolicy = "reservation";
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE id=?")
      .bind(JSON.stringify(snapshot), publication!.id)
      .run();
    expect(
      (
        await setSessionParticipation(env.DB, eventId, occurrenceId, users[0], {
          action: "reserve",
          attendanceMode: "physical",
          roomId: rooms[0],
        })
      ).status,
    ).toBe("reserved");
    expect(
      (
        await setSessionParticipation(env.DB, eventId, occurrenceId, users[1], {
          action: "reserve",
          attendanceMode: "physical",
          roomId: rooms[0],
        })
      ).status,
    ).toBe("waitlisted");
    await approvedCapacity(1);
    expect(
      (
        await setSessionParticipation(env.DB, eventId, occurrenceId, users[1], {
          action: "reserve",
          attendanceMode: "physical",
          roomId: rooms[1],
        })
      ).status,
    ).toBe("waitlisted");
    expect(await scan(1, rooms[1])).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
      recorded: true,
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    await approvedCapacity(2);
    expect(
      (
        await setSessionParticipation(env.DB, eventId, occurrenceId, users[1], {
          action: "reserve",
          attendanceMode: "physical",
          roomId: rooms[1],
        })
      ).status,
    ).toBe("reserved");
  });
  it("keeps physical reservations and offline eligibility in their selected room", async () => {
    await approvedCapacity(2, "reservation");
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,room_id,created_at,updated_at) VALUES(?,?,?,?,'physical','reserved',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, occurrenceId, users[0], rooms[0], now, now)
      .run();
    const manifest = await offlineEligibility(env.DB, eventId, operatorId, { occurrenceId, roomId: rooms[1] });
    expect(manifest.roomId).toBe(rooms[1]);
    expect(manifest.entries.find((entry) => entry.userId === users[0])?.sessionEligible).toBe(false);
    await env.DB.prepare("UPDATE event_agenda_rooms SET capacity=2 WHERE id=?").bind(rooms[0]).run();
    await patchAgendaOccurrence(env.DB, eventId, "multi-room-test", occurrenceId, {
      expectedRevision: 0,
      additionalRoomIds: [],
    });
    expect((await getAgenda(env.DB, eventId, "multi-room-test")).occurrences[0].additionalRoomIds).toEqual([]);
  });
  it("guards secondary room overlap and setup without duplicating the canonical speaker/session", async () => {
    const snapshot = await getAgenda(env.DB, eventId, "multi-room-test");
    expect(snapshot.occurrences).toHaveLength(1);
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id) VALUES(?,?,'Competing talk',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, snapshot.occurrences[0].startAt, snapshot.occurrences[0].endAt, rooms[1])
      .run();
    await expect(
      patchAgendaOccurrence(env.DB, eventId, "multi-room-test", occurrenceId, {
        expectedRevision: 0,
        title: "Still one talk",
      }),
    ).rejects.toMatchObject({ code: "AGENDA_SCHEDULE_CONFLICT" });
  });
  it("reports private invitation context without manufacturing a reserved seat", async () => {
    const publication = await env.DB.prepare("SELECT id,snapshot_json FROM event_agenda_publications WHERE event_id=?")
      .bind(eventId)
      .first<{ id: string; snapshot_json: string }>();
    const snapshot = JSON.parse(publication!.snapshot_json);
    snapshot.occurrences[0].visibility = "private";
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE id=?")
      .bind(JSON.stringify(snapshot), publication!.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO agenda_session_invitations(id,event_id,occurrence_id,user_id,invited_by,reason_code,created_at,room_id) VALUES(?,?,?,?,?,'organizer_approval',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, occurrenceId, users[0], operatorId, new Date().toISOString(), rooms[0])
      .run();
    expect(await scan(0, rooms[1], { action: "check" })).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
    });
    expect(await scan(1, rooms[0], { action: "check" })).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
    });
    const manifest = await offlineEligibility(env.DB, eventId, operatorId, { occurrenceId, roomId: rooms[0] });
    expect(manifest.entries.find((entry) => entry.userId === users[0])?.privateAccess).toBe(true);
    expect(await scan(0, rooms[0])).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    await env.DB.prepare("UPDATE agenda_session_invitations SET revoked_at=? WHERE occurrence_id=? AND user_id=?")
      .bind(new Date().toISOString(), occurrenceId, users[0])
      .run();
    expect(await scan(0, rooms[0], { action: "check" })).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
    });
  });
});
