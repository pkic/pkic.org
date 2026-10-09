import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaPublicationSchema,
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
import type { DatabaseLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
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
        title: `Planning allocation session ${index + 1}`,
        description: "An independent session about reliable certificate lifecycle operations and interoperability.",
        startAt: index === 0 ? "2026-12-01T09:00:00.000Z" : null,
        endAt: index === 0 ? "2026-12-01T10:00:00.000Z" : null,
        roomId: index === 0 ? roomId : null,
      }),
    );
    ids.push(snapshot.occurrences.find((item) => item.title === `Planning allocation session ${index + 1}`)!.id);
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
  async function apply(input: ReturnType<typeof proposal>) {
    const reviewed = await review(input);
    const response = await raw(
      `${base}/schedule`,
      agendaScheduleApplySchema.parse({ ...input, reviewHash: reviewed.reviewHash }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return agendaSnapshotSchema.parse(await response.json());
  }
  /** Approval needs reviewed public credits; the people and their placements are unchanged. */
  async function approve(snapshot: AgendaSnapshot) {
    for (const session of snapshot.occurrences)
      if (session.speakers.length)
        await seedApprovedSessionAppearances(env.DB, {
          occurrenceId: session.id,
          reviewerId: admin.id,
          appearances: session.speakers.map((speaker) =>
            individualAppearanceFixture({
              userId: speaker.userId,
              displayName: `Presenter ${speaker.userId.slice(0, 8)}`,
              approvedAt: "2026-10-04T00:00:00.000Z",
            }),
          ),
        });
    return raw(`${base}/publications`, agendaPublicationSchema.parse({ expectedRevision: snapshot.revision }));
  }
  async function approved(snapshot: AgendaSnapshot) {
    const response = await approve(snapshot);
    expect(response.status, await response.clone().text()).toBe(200);
    const published = agendaSnapshotSchema.parse(await response.json());
    expect(published.publishedRevision).toBe(published.revision);
    return published;
  }
  return { eventId, ids, people, roomId, otherRoomId, raw, read, proposal, review, apply, approve, approved, register };
}

describe("agenda planning and approval never enforce attendance capacity", () => {
  it("applies an unchanged slot and a room/time move on an overfull day without touching allocations, then approves", async () => {
    const f = await fixture();
    let snapshot = await f.read();
    const registrations = await queryAll(env.DB, "SELECT * FROM registrations ORDER BY id");
    const dayAttendance = await queryAll(env.DB, "SELECT * FROM registration_day_attendance ORDER BY id");
    snapshot = await f.apply(
      agendaScheduleProposalSchema.parse({
        expectedRevision: snapshot.revision,
        changes: [
          { id: f.ids[0], startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T10:00:00.000Z", roomId: f.roomId },
        ],
      }),
    );
    snapshot = await f.apply(f.proposal(snapshot, f.ids[0], f.otherRoomId));
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
    await f.approved(snapshot);
    expect(await queryAll(env.DB, "SELECT * FROM registrations ORDER BY id")).toEqual(registrations);
  });

  it("places an unscheduled presenter already registered for the day", async () => {
    const f = await fixture(1, true);
    const saved = await f.apply(f.proposal(await f.read(), f.ids[1], f.roomId, "11"));
    expect(saved.occurrences.find((item) => item.id === f.ids[1])!.startAt).toBe("2026-12-01T11:00:00.000Z");
    expect(await queryAll(env.DB, "SELECT * FROM agenda_session_participations")).toEqual([]);
  });

  it("accepts a new unregistered presenter on the overfull day and approves the agenda", async () => {
    const f = await fixture();
    const saved = await f.apply(f.proposal(await f.read(), f.ids[1], f.roomId, "11"));
    expect(saved.occurrences.find((item) => item.id === f.ids[1])!.startAt).toBe("2026-12-01T11:00:00.000Z");
    const published = await f.approved(saved);
    expect(
      await queryAll(
        env.DB,
        "SELECT user_id FROM event_agenda_operational_days WHERE event_id=? AND revision=? ORDER BY user_id",
        [f.eventId, published.publishedRevision],
      ),
    ).toEqual([f.people[0]!, f.people[2]!].sort().map((user_id) => ({ user_id })));
    expect(await queryAll(env.DB, "SELECT * FROM registrations")).toHaveLength(2);
  });

  it("allows removing the existing operational person from the day without altering their registration", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    const saved = await f.apply(
      agendaScheduleProposalSchema.parse({
        expectedRevision: snapshot.revision,
        changes: [{ id: f.ids[0], startAt: null, endAt: null, roomId: null }],
      }),
    );
    expect(saved.occurrences.find((item) => item.id === f.ids[0])!.startAt).toBeNull();
    expect(await queryAll(env.DB, "SELECT * FROM registrations")).toHaveLength(2);
  });

  it("moves a session whose finite capacity is below its operational presenters", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE event_agenda_occurrences SET capacity=0 WHERE id=?").bind(f.ids[0]).run();
    const saved = await f.apply(f.proposal(await f.read()));
    expect(saved.occurrences.find((item) => item.id === f.ids[0])).toMatchObject({
      capacity: 0,
      startAt: "2026-12-01T10:00:00.000Z",
    });
    await f.approved(saved);
  });

  it("saves a room with more seats than the event day capacity and approves the agenda", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    const input = agendaRoomCreateSchema.parse({
      expectedRevision: snapshot.revision,
      name: "Main hall",
      capacity: 900,
      setupMinutes: 0,
    });
    const response = await f.raw(`${base}/rooms/${f.roomId}`, input, undefined, "PUT");
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = agendaSnapshotSchema.parse(await response.json());
    expect(saved.rooms.find((room) => room.id === f.roomId)).toMatchObject({ name: "Main hall", capacity: 900 });
    const published = await f.approved(saved);
    expect(published.rooms.find((room) => room.id === f.roomId)!.capacity).toBe(900);
  });
});

describe("agenda planning and approval preserve existing allocations", () => {
  it("refuses moving an existing reservation to another room or attendance mode", async () => {
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
      expect(await response.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_ALLOCATION" } });
      expect(await effects()).toEqual(before);
    }
  });

  it("refuses approval when a reservation was made in a room the draft no longer uses", async () => {
    const f = await fixture();
    const moved = await f.apply(f.proposal(await f.read(), f.ids[0], f.otherRoomId));
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,room_id,status,created_at,updated_at) VALUES(?,?,?,?,'physical',?,'reserved',datetime('now'),datetime('now'))",
    )
      .bind(crypto.randomUUID(), f.eventId, f.ids[0], f.people[1], f.roomId)
      .run();
    const response = await f.approve(moved);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_RESERVED_ALLOCATION" } });
    expect((await f.read()).publishedRevision).toBeNull();
  });

  it("rechecks a reservation committed after review inside the schedule-write batch and rolls back all schedule effects", async () => {
    const f = await fixture();
    const input = f.proposal(await f.read(), f.ids[0], f.otherRoomId);
    const reviewed = await f.review(input);
    const before = await effects();
    const reservationId = crypto.randomUUID();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE event_agenda_occurrences SET start_at="),
      async () => {
        raced = true;
        await env.DB.prepare(
          "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,room_id,status,created_at,updated_at) VALUES(?,?,?,?,'physical',?,'reserved',datetime('now'),datetime('now'))",
        )
          .bind(reservationId, f.eventId, f.ids[0], f.people[1], f.roomId)
          .run();
      },
    );
    const response = await f.raw(`${base}/schedule`, { ...input, reviewHash: reviewed.reviewHash }, db);
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    const after = await effects();
    // Only the independently committed reservation survives the rejected schedule write.
    const participationIndex = effectTables.indexOf("agenda_session_participations");
    expect(after[participationIndex]).toHaveLength(1);
    expect(after[participationIndex]![0]).toMatchObject({ id: reservationId, room_id: f.roomId, status: "reserved" });
    after[participationIndex] = [];
    expect(after).toEqual(before);
  });
});

describe("draft session and room edits ignore event-day and room capacity", () => {
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
  });

  it("adds a new physical presenter through session editing on an overfull day", async () => {
    const f = await fixture();
    const snapshot = await f.read();
    const response = await f.raw(
      `${base}/occurrences/${f.ids[0]}`,
      agendaOccurrencePatchSchema.parse({
        expectedRevision: snapshot.revision,
        speakerUserIds: [f.people[0], f.people[2]],
      }),
      undefined,
      "PATCH",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = agendaSnapshotSchema.parse(await response.json());
    expect(
      saved.occurrences
        .find((item) => item.id === f.ids[0])!
        .speakers.map((speaker) => speaker.userId)
        .sort(),
    ).toEqual([f.people[0]!, f.people[2]!].sort());
  });

  it("saves a room capacity below its operational occupancy", async () => {
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
    const downsize = await f.raw(
      `${base}/rooms/${f.roomId}`,
      { ...input, expectedRevision: saved.revision, capacity: 0 },
      undefined,
      "PUT",
    );
    expect(downsize.status, await downsize.clone().text()).toBe(200);
    expect(agendaSnapshotSchema.parse(await downsize.json()).rooms.find((room) => room.id === f.roomId)!.capacity).toBe(
      0,
    );
  });

  it("refuses a session capacity edit below confirmed physical or remote reservations", async () => {
    const f = await fixture();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,room_id,status,created_at,updated_at) VALUES(?,?,?,?,'physical',?,'reserved',datetime('now'),datetime('now'))",
      ).bind(crypto.randomUUID(), f.eventId, f.ids[0], f.people[1], f.roomId),
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'remote','reserved',datetime('now'),datetime('now'))",
      ).bind(crypto.randomUUID(), f.eventId, f.ids[0], f.people[3]),
    ]);
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

  it("saves a title edit on a session already over its physical and remote limits", async () => {
    const f = await fixture();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,room_id,status,created_at,updated_at) VALUES(?,?,?,?,'physical',?,'reserved',datetime('now'),datetime('now'))",
      ).bind(crypto.randomUUID(), f.eventId, f.ids[0], f.people[1], f.roomId),
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'remote','reserved',datetime('now'),datetime('now'))",
      ).bind(crypto.randomUUID(), f.eventId, f.ids[0], f.people[3]),
      env.DB.prepare("UPDATE event_agenda_occurrences SET capacity=0,remote_capacity=0 WHERE id=?").bind(f.ids[0]),
    ]);
    const snapshot = await f.read();
    const response = await f.raw(
      `${base}/occurrences/${f.ids[0]}`,
      agendaOccurrencePatchSchema.parse({ expectedRevision: snapshot.revision, title: "Renamed while full" }),
      undefined,
      "PATCH",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      agendaSnapshotSchema.parse(await response.json()).occurrences.find((item) => item.id === f.ids[0]),
    ).toMatchObject({ title: "Renamed while full", capacity: 0, remoteCapacity: 0 });
  });

  it("saves a room capacity edit while an allocation is committed concurrently and preserves the reservation", async () => {
    const f = await fixture();
    const snapshot = await f.read();
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
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id,room_id,status FROM agenda_session_participations")).toEqual([
      { id: reservationId, room_id: f.roomId, status: "reserved" },
    ]);
  });
});
