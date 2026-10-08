import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../assets/shared/schemas/event-agenda";
import {
  agendaScheduleApplySchema,
  agendaScheduleProposalSchema,
  agendaScheduleReviewSchema,
} from "../assets/shared/schemas/event-agenda-schedule";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { assertPublicationCapacity } from "../functions/_lib/services/event-agenda/publication-capacity";
import type { DatabaseLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

const base = "/api/v1/events/pqc-2026/agenda";
beforeEach(resetDb);

const effectTables = [
  "event_agenda_state",
  "event_agenda_occurrences",
  "event_agenda_occurrence_rooms",
  "event_agenda_occurrence_speakers",
  "event_agenda_publications",
  "event_agenda_operational_days",
  "event_agenda_operational_people",
  "agenda_session_participations",
  "agenda_session_holds",
  "audit_log",
  "email_outbox",
  "agenda_push_outbox",
  "site_publication_requests",
];
async function effects() {
  return Promise.all(effectTables.map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)));
}
async function fixture(dayCapacity = 1, secondRegistered = false) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const dayId = crypto.randomUUID(),
    roomId = crypto.randomUUID(),
    otherRoomId = crypto.randomUUID();
  const people = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    ...people.map((id) =>
      env.DB.prepare(
        "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))",
      ).bind(id, `${id}@example.test`, `${id}@example.test`),
    ),
    ...[roomId, otherRoomId].map((id, index) =>
      env.DB.prepare(
        "INSERT INTO event_agenda_rooms(id,event_id,name,setup_minutes,capacity) VALUES(?,?,?,0,NULL)",
      ).bind(id, eventId, `Room ${index + 1}`),
    ),
  ]);
  let snapshot: AgendaSnapshot | undefined;
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: snapshot?.revision ?? 0,
        title: `Planning capacity session ${index + 1}`,
        description: "An independent session about reliable certificate lifecycle operations and interoperability.",
        startAt: index === 0 ? "2026-12-01T09:00:00.000Z" : null,
        endAt: index === 0 ? "2026-12-01T10:00:00.000Z" : null,
        roomId: index === 0 ? roomId : null,
      }),
    );
    ids.push(snapshot.occurrences.find((item) => item.title === `Planning capacity session ${index + 1}`)!.id);
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,in_person_capacity,created_at,updated_at) VALUES(?,?,'2026-12-01',?,datetime('now'),datetime('now'))",
    ).bind(dayId, eventId, dayCapacity),
    ...ids.map((id, index) =>
      env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)").bind(
        id,
        people[index === 0 ? 0 : 2],
      ),
    ),
  ]);
  async function register(userId: string) {
    const registrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,datetime('now'),datetime('now'))",
      ).bind(registrationId, eventId, userId, crypto.randomUUID()),
      env.DB.prepare(
        "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) VALUES(?,?,?,'in_person',datetime('now'),datetime('now'))",
      ).bind(crypto.randomUUID(), registrationId, dayId),
    ]);
  }
  await register(people[0]!);
  await register(people[1]!);
  if (secondRegistered) await register(people[2]!);
  const raw = (
    path: string,
    body?: unknown,
    database: DatabaseLike = env.DB,
    method = body === undefined ? "GET" : "POST",
  ) =>
    callApi({ ...env, DB: database }, path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function read() {
    const response = await raw(base);
    expect(response.status).toBe(200);
    return agendaSnapshotSchema.parse(await response.json());
  }
  function proposal(snapshot: AgendaSnapshot, id = ids[0]!, room = roomId, hour = "10") {
    return agendaScheduleProposalSchema.parse({
      expectedRevision: snapshot.revision,
      changes: [
        {
          id,
          roomId: room,
          additionalRoomIds: [],
          startAt: `2026-12-01T${hour}:00:00.000Z`,
          endAt: `2026-12-01T${hour}:30:00.000Z`,
        },
      ],
    });
  }
  async function review(input: ReturnType<typeof proposal>) {
    const response = await raw(`${base}/schedule/reviews`, input);
    expect(response.status, await response.clone().text()).toBe(200);
    return agendaScheduleReviewSchema.parse(await response.json());
  }
  return { eventId, ids, people, roomId, otherRoomId, raw, read, proposal, review, register };
}

describe("draft schedule preserves existing event-day overage without adding demand", () => {
  it("reviews and applies an unchanged slot and a room/time move without touching allocations; publication remains strict", async () => {
    const f = await fixture();
    let snapshot = await f.read();
    const registrations = await queryAll(env.DB, "SELECT * FROM registrations ORDER BY id");
    const dayAttendance = await queryAll(env.DB, "SELECT * FROM registration_day_attendance ORDER BY id");
    for (const input of [
      agendaScheduleProposalSchema.parse({
        expectedRevision: snapshot.revision,
        changes: [
          {
            id: f.ids[0],
            startAt: "2026-12-01T09:00:00.000Z",
            endAt: "2026-12-01T10:00:00.000Z",
            roomId: f.roomId,
          },
        ],
      }),
      f.proposal({ ...snapshot, revision: snapshot.revision + 1 }, f.ids[0], f.otherRoomId),
    ]) {
      const reviewed = await f.review(input);
      const response = await f.raw(
        `${base}/schedule`,
        agendaScheduleApplySchema.parse({ ...input, reviewHash: reviewed.reviewHash }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      snapshot = agendaSnapshotSchema.parse(await response.json());
    }
    expect(snapshot.occurrences.find((item) => item.id === f.ids[0])).toMatchObject({
      roomId: f.otherRoomId,
      startAt: "2026-12-01T10:00:00.000Z",
    });
    expect(await queryAll(env.DB, "SELECT * FROM registrations ORDER BY id")).toEqual(registrations);
    expect(await queryAll(env.DB, "SELECT * FROM registration_day_attendance ORDER BY id")).toEqual(dayAttendance);
    expect(await queryAll(env.DB, "SELECT * FROM agenda_session_participations")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT * FROM agenda_session_holds")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT * FROM email_outbox")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT * FROM agenda_push_outbox")).toEqual([]);
    await expect(assertPublicationCapacity(env.DB, snapshot)).rejects.toMatchObject({
      code: "AGENDA_RESERVED_CAPACITY",
    });
  });

  it("places an unscheduled presenter already registered for the day without adding day demand", async () => {
    const f = await fixture(1, true);
    const input = f.proposal(await f.read(), f.ids[1], f.roomId, "11");
    const reviewed = await f.review(input);
    const response = await f.raw(`${base}/schedule`, { ...input, reviewHash: reviewed.reviewHash });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      agendaSnapshotSchema.parse(await response.json()).occurrences.find((item) => item.id === f.ids[1])!.startAt,
    ).toBe("2026-12-01T11:00:00.000Z");
    expect(await queryAll(env.DB, "SELECT * FROM agenda_session_participations")).toEqual([]);
  });

  it("refuses a new unregistered presenter on the overfull day with every agenda effect unchanged", async () => {
    const f = await fixture();
    const before = await effects();
    const response = await f.raw(`${base}/schedule/reviews`, f.proposal(await f.read(), f.ids[1], f.roomId, "11"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_CAPACITY" } });
    expect(await effects()).toEqual(before);
  });

  it("allows removing the existing operational person from the day without altering their registration", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    const input = agendaScheduleProposalSchema.parse({
      expectedRevision: snapshot.revision,
      changes: [{ id: f.ids[0], startAt: null, endAt: null, roomId: null }],
    });
    const reviewed = await f.review(input);
    const response = await f.raw(`${base}/schedule`, { ...input, reviewHash: reviewed.reviewHash });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      agendaSnapshotSchema.parse(await response.json()).occurrences.find((item) => item.id === f.ids[0])!.startAt,
    ).toBeNull();
    expect(await queryAll(env.DB, "SELECT * FROM registrations")).toHaveLength(2);
  });

  it("keeps finite session capacity strict even when a move adds no day demand", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE event_agenda_occurrences SET capacity=0 WHERE id=?").bind(f.ids[0]).run();
    const before = await effects();
    const response = await f.raw(`${base}/schedule/reviews`, f.proposal(await f.read()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_CAPACITY" } });
    expect(await effects()).toEqual(before);
  });

  it("preserves an existing reservation's physical room and mode despite the relaxed day-overage comparison", async () => {
    const f = await fixture();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,room_id,status,created_at,updated_at) VALUES(?,?,?,?,'physical',?,'reserved',datetime('now'),datetime('now'))",
    )
      .bind(crypto.randomUUID(), f.eventId, f.ids[0], f.people[0], f.roomId)
      .run();
    const snapshot = await f.read();
    const before = await effects();
    const move = f.proposal(snapshot, f.ids[0], f.otherRoomId);
    const changeMode = agendaScheduleProposalSchema.parse({
      ...f.proposal(snapshot),
      changes: [
        {
          ...f.proposal(snapshot).changes[0],
          speakerPlacements: {
            [f.people[0]!]: { attendanceMode: "remote", roomId: null },
          },
        },
      ],
    });
    for (const input of [move, changeMode]) {
      const response = await f.raw(`${base}/schedule/reviews`, input);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_CAPACITY" } });
      expect(await effects()).toEqual(before);
    }
  });

  it("recounts a concurrent day registration inside the actual schedule-write batch and rolls back all schedule effects", async () => {
    const f = await fixture(3);
    const input = f.proposal(await f.read(), f.ids[1], f.roomId, "11");
    const reviewed = await f.review(input);
    const before = await effects();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE event_agenda_occurrences SET start_at="),
      async () => {
        raced = true;
        await f.register(f.people[3]!);
      },
    );
    const response = await f.raw(`${base}/schedule`, { ...input, reviewHash: reviewed.reviewHash }, db);
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await effects()).toEqual(before);
    expect(await queryAll(env.DB, "SELECT * FROM registrations")).toHaveLength(3);
    expect(await queryAll(env.DB, "SELECT * FROM registration_day_attendance")).toHaveLength(3);
  });
});

describe("draft session and room edits preserve independent capacity limits", () => {
  it("saves a title-only edit on an overfull event day while null session and room capacities stay unlimited", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    const response = await f.raw(
      `${base}/occurrences/${f.ids[0]}`,
      agendaOccurrencePatchSchema.parse({
        expectedRevision: snapshot.revision,
        title: "Corrected draft session title",
      }),
      undefined,
      "PATCH",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = agendaSnapshotSchema.parse(await response.json());
    expect(saved.revision).toBe(snapshot.revision + 1);
    expect(saved.occurrences.find((item) => item.id === f.ids[0])).toMatchObject({
      title: "Corrected draft session title",
      capacity: null,
      remoteCapacity: null,
      startAt: "2026-12-01T09:00:00.000Z",
      roomId: f.roomId,
    });
    expect(saved.rooms.find((room) => room.id === f.roomId)!.capacity).toBeNull();
    expect(await queryAll(env.DB, "SELECT * FROM registrations")).toHaveLength(2);
    expect(await queryAll(env.DB, "SELECT * FROM agenda_session_participations")).toEqual([]);
    await expect(assertPublicationCapacity(env.DB, saved)).rejects.toMatchObject({ code: "AGENDA_RESERVED_CAPACITY" });
  });

  it("refuses adding a new physical presenter through session editing to an overfull day without side effects", async () => {
    const f = await fixture();
    const snapshot = await f.read(),
      before = await effects();
    const response = await f.raw(
      `${base}/occurrences/${f.ids[0]}`,
      agendaOccurrencePatchSchema.parse({
        expectedRevision: snapshot.revision,
        speakerUserIds: [f.people[0], f.people[2]],
      }),
      undefined,
      "PATCH",
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_CAPACITY" } });
    expect(await effects()).toEqual(before);
  });

  it("renames an unlimited room on an overfull day but refuses a finite limit below its operational occupancy", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    const input = agendaRoomCreateSchema.parse({
      expectedRevision: snapshot.revision,
      name: "Renamed unlimited hall",
      capacity: null,
      setupMinutes: 0,
    });
    const response = await f.raw(`${base}/rooms/${f.roomId}`, input, undefined, "PUT");
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = agendaSnapshotSchema.parse(await response.json());
    expect(saved.rooms.find((room) => room.id === f.roomId)).toMatchObject({ name: input.name, capacity: null });
    const before = await effects();
    const downsize = await f.raw(
      `${base}/rooms/${f.roomId}`,
      { ...input, expectedRevision: saved.revision, capacity: 0 },
      undefined,
      "PUT",
    );
    expect(downsize.status).toBe(409);
    expect(await downsize.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_CAPACITY" } });
    expect(await effects()).toEqual(before);
  });

  it("does not relax the session physical or remote pool when editing a draft with null room capacity", async () => {
    const f = await fixture();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'remote','reserved',datetime('now'),datetime('now'))",
    )
      .bind(crypto.randomUUID(), f.eventId, f.ids[0], f.people[1])
      .run();
    const snapshot = await f.read(),
      before = await effects();
    for (const limits of [{ capacity: 0 }, { remoteCapacity: 0 }]) {
      const response = await f.raw(
        `${base}/occurrences/${f.ids[0]}`,
        agendaOccurrencePatchSchema.parse({ expectedRevision: snapshot.revision, ...limits }),
        undefined,
        "PATCH",
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_CAPACITY" } });
      expect(await effects()).toEqual(before);
    }
  });

  it("guards a presenter edit against a day registration committed after preflight and rolls back every edit effect", async () => {
    const f = await fixture(3);
    const snapshot = await f.read(),
      before = await effects();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE event_agenda_occurrences SET title="),
      async () => {
        raced = true;
        await f.register(f.people[3]!);
      },
    );
    const response = await f.raw(
      `${base}/occurrences/${f.ids[0]}`,
      agendaOccurrencePatchSchema.parse({
        expectedRevision: snapshot.revision,
        speakerUserIds: [f.people[0], f.people[2]],
      }),
      db,
      "PATCH",
    );
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await effects()).toEqual(before);
    expect(await queryAll(env.DB, "SELECT * FROM registrations")).toHaveLength(3);
  });

  it("guards a room edit against an allocation committed after preflight and preserves both the old room and competing reservation", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    const before = await effects();
    const reservationId = crypto.randomUUID();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE event_agenda_rooms SET name="),
      async () => {
        raced = true;
        await env.DB.prepare(
          "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,room_id,status,created_at,updated_at) VALUES(?,?,?,?,'physical',?,'reserved',datetime('now'),datetime('now'))",
        )
          .bind(reservationId, f.eventId, f.ids[0], f.people[1], f.roomId)
          .run();
      },
    );
    const response = await f.raw(
      `${base}/rooms/${f.roomId}`,
      agendaRoomCreateSchema.parse({
        expectedRevision: snapshot.revision,
        name: "Concurrent room edit",
        capacity: 1,
        setupMinutes: 0,
      }),
      db,
      "PUT",
    );
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    const after = await effects();
    // Only the independently committed reservation survives the rejected edit.
    const participationIndex = effectTables.indexOf("agenda_session_participations");
    expect(after[participationIndex]).toHaveLength(1);
    expect(after[participationIndex]![0]).toMatchObject({ id: reservationId, room_id: f.roomId, status: "reserved" });
    after[participationIndex] = [];
    expect(after).toEqual(before);
  });
});
