import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import {
  createAgendaRoom,
  createAgendaOccurrence,
  patchAgendaOccurrence,
  swapAgendaOccurrences,
  saveAgendaStaffing,
  publishAgenda,
} from "../functions/_lib/services/event-agenda/mutations";
import { importAgenda } from "../functions/_lib/services/event-agenda/import";
import { agendaConflicts, allocateAgendaRoles } from "../assets/shared/event-agenda-policy";
import { agendaOccurrenceCreateSchema } from "../assets/shared/schemas/event-agenda";

describe("agenda platform", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("uses mounted contracts, authentication and shared pagination", async () => {
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin.id, "agenda-route-test");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const denied = await callApi(env, "/api/v1/events/pqc-2026/agenda");
    expect(denied.status).toBe(401);
    const created = await callApi(env, "/api/v1/events/pqc-2026/agenda/rooms", {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 0, name: "Room", capacity: 20 }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ revision: 1, rooms: [{ name: "Room", capacity: 20 }] });
    const page = await callApi(env, "/api/v1/events/pqc-2026/agenda/occurrences?limit=10&q=none", { headers });
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ occurrences: [], page: { total: 0, limit: 10 } });
    const invalid = await callApi(env, "/api/v1/events/pqc-2026/agenda/rooms", {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 1, name: "", capacity: -1 }),
    });
    expect(invalid.status).toBe(400);
  });
  it("guards room collisions, stale revisions, and atomic swaps", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    let snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      name: "Main hall",
      setupMinutes: 0,
      capacity: 40,
    });
    const roomId = snapshot.rooms[0].id;
    const base = {
      title: "Talk",
      description: "",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId,
      admissionPolicy: "preference",
      capacity: null,
      visibility: "public",
      kind: "session",
      speakerUserIds: [],
    };
    snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({ ...base, expectedRevision: 1 }),
    );
    await expect(
      createAgendaOccurrence(
        env.DB,
        eventId,
        "pqc-2026",
        agendaOccurrenceCreateSchema.parse({ ...base, expectedRevision: 2 }),
      ),
    ).rejects.toMatchObject({ code: "AGENDA_SCHEDULE_CONFLICT" });
    await expect(
      patchAgendaOccurrence(env.DB, eventId, "pqc-2026", snapshot.occurrences[0].id, {
        expectedRevision: 1,
        title: "Stale",
      }),
    ).rejects.toMatchObject({ code: "AGENDA_REVISION_CHANGED" });
    snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        ...base,
        title: "Later",
        startAt: "2026-12-01T10:00:00.000Z",
        endAt: "2026-12-01T11:00:00.000Z",
        expectedRevision: 2,
      }),
    );
    const first = snapshot.occurrences[0].id,
      second = snapshot.occurrences[1].id;
    snapshot = await swapAgendaOccurrences(env.DB, eventId, "pqc-2026", 3, first, second);
    expect(snapshot.occurrences.find((item) => item.id === first)?.startAt).toBe("2026-12-01T10:00:00.000Z");
    expect(snapshot.revision).toBe(4);
  });
  it("preserves imported edits and freezes only public scheduled sessions", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const candidate = agendaOccurrenceCreateSchema.omit({ expectedRevision: true }).parse({
      title: "Historical talk",
      presentationUrl: "/events/slides.pdf",
      recordingUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
    });
    let imported = await importAgenda(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      source: "legacy",
      dryRun: false,
      occurrences: [{ ...candidate, sourceKey: "legacy:one" }],
    });
    expect(imported.imported).toBe(1);
    const id = imported.agenda.occurrences[0].id;
    await patchAgendaOccurrence(env.DB, eventId, "pqc-2026", id, {
      expectedRevision: 1,
      title: "Organizer correction",
    });
    imported = await importAgenda(env.DB, eventId, "pqc-2026", {
      expectedRevision: 2,
      source: "legacy",
      dryRun: false,
      occurrences: [{ ...candidate, sourceKey: "legacy:one" }],
    });
    expect(imported.skipped).toBe(1);
    expect(imported.agenda.occurrences[0].title).toBe("Organizer correction");
    await publishAgenda(env.DB, eventId, "pqc-2026", 2, admin.id);
    const [publication] = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?",
      eventId,
    );
    expect(JSON.parse(publication.snapshot_json)).toMatchObject({
      revision: 3,
      roleMembers: [],
      assignments: [],
      occurrences: [
        {
          title: "Organizer correction",
          presentationUrl: "/events/slides.pdf",
          recordingUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        },
      ],
    });
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?, 'physical','reserved',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, id, admin.id, "2026-10-03T10:00:00.000Z", "2026-10-03T10:00:00.000Z")
      .run();
    await patchAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      id,
      { expectedRevision: 3, title: "Approved change" },
      admin.id,
    );
    await publishAgenda(env.DB, eventId, "pqc-2026", 4, admin.id);
    const notifications = await queryAll<{ recipient_user_id: string }>(
      env.DB,
      "SELECT recipient_user_id FROM email_outbox WHERE template_key='agenda_changed' AND event_id=?",
      eventId,
    );
    expect(notifications).toEqual([{ recipient_user_id: admin.id }]);
  });
  it("freezes private sessions operationally while omitting them from the public build projection", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
    const base = { startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T10:00:00.000Z", roomId: null };
    await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({ ...base, title: "Public talk", visibility: "public", expectedRevision: 0 }),
      admin.id,
    );
    await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        ...base,
        title: "Private briefing",
        visibility: "private",
        expectedRevision: 1,
      }),
      admin.id,
    );
    await publishAgenda(env.DB, eventId, "pqc-2026", 2, admin.id);
    const [approved] = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?",
      eventId,
    );
    expect(
      JSON.parse(approved.snapshot_json)
        .occurrences.map((item: { title: string }) => item.title)
        .sort(),
    ).toEqual(["Private briefing", "Public talk"]);
    const publicProjection = await readSitePublicationSnapshot(env.DB, []);
    expect(publicProjection.eventAgendas?.["pqc-2026"].occurrences.map((item) => item.title)).toEqual(["Public talk"]);
  });
  it("refuses approval when bookings grew against the previous approved capacity", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const now = new Date().toISOString();
    const users = [crypto.randomUUID(), crypto.randomUUID()];
    for (const userId of users)
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users(id,email,normalized_email,role,active,created_at,updated_at) VALUES(?,?,?,'user',1,?,?)",
        ).bind(userId, `${userId}@example.test`, `${userId}@example.test`, now, now),
        env.DB.prepare(
          "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','synthetic',?,?,?)",
        ).bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), now, now),
      ]);
    let snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        title: "Capacity race",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        admissionPolicy: "reservation",
        capacity: 2,
        expectedRevision: 0,
      }),
      admin.id,
    );
    const occurrenceId = snapshot.occurrences[0].id;
    snapshot = await publishAgenda(env.DB, eventId, "pqc-2026", 1, admin.id);
    await setSessionParticipation(env.DB, eventId, occurrenceId, users[0], {
      action: "reserve",
      attendanceMode: "physical",
    });
    snapshot = await patchAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      occurrenceId,
      { expectedRevision: snapshot.revision, capacity: 1 },
      admin.id,
    );
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, users[1], {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "reserved" });
    await expect(publishAgenda(env.DB, eventId, "pqc-2026", snapshot.revision, admin.id)).rejects.toMatchObject({
      status: 409,
    });
    const [state] = await queryAll<{ published_revision: number; revision: number }>(
      env.DB,
      "SELECT published_revision,revision FROM event_agenda_state WHERE event_id=?",
      eventId,
    );
    expect(state).toEqual({ published_revision: 2, revision: 3 });
  });
  it("rejects pinned duty conflicts and preserves the previous schedule", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    await saveAgendaStaffing(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      blocks: [
        {
          id: "opening",
          name: "Opening",
          startAt: "2026-12-01T09:00:00.000Z",
          endAt: "2026-12-01T10:00:00.000Z",
          roomId: null,
          roles: ["mc"],
          roleRequirements: [],
        },
      ],
      roleMembers: [
        {
          userId: admin.id,
          displayName: "Senior MC",
          roles: ["mc"],
          availableFrom: null,
          availableUntil: null,
          maxMinutes: null,
          seniority: "junior" as const,
          attendanceMode: "physical" as const,
        },
      ],
      assignments: [{ blockId: "opening", role: "mc", userId: admin.id, pinned: true }],
    });
    await expect(
      createAgendaOccurrence(
        env.DB,
        eventId,
        "pqc-2026",
        agendaOccurrenceCreateSchema.parse({
          expectedRevision: 1,
          title: "Conflicting talk",
          startAt: "2026-12-01T09:30:00.000Z",
          endAt: "2026-12-01T10:30:00.000Z",
          roomId: null,
          speakerUserIds: [admin.id],
        }),
      ),
    ).rejects.toMatchObject({ code: "AGENDA_SCHEDULE_CONFLICT" });
    const [state] = await queryAll<{ revision: number }>(
      env.DB,
      "SELECT revision FROM event_agenda_state WHERE event_id=?",
      eventId,
    );
    expect(state.revision).toBe(1);
  });
  it("requires setup and travel time and senior on-site staffing", () => {
    const speaker = { userId: "person", displayName: "Person" };
    const base = agendaOccurrenceCreateSchema
      .omit({ expectedRevision: true })
      .parse({ title: "A", startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T10:00:00.000Z", roomId: "room-a" });
    const a = { ...base, id: "a", speakers: [speaker] };
    const b = {
      ...base,
      id: "b",
      title: "B",
      startAt: "2026-12-01T10:05:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
      speakers: [speaker],
      roomId: "room-b",
    };
    expect(agendaConflicts([a, b], 10)).toContain("A and B need speaker travel time");
    expect(agendaConflicts([a, { ...b, roomId: "room-a" }], 0, [{ id: "room-a", setupMinutes: 10 }])).toContain(
      "A and B need room setup time",
    );
    const block = {
      id: "opening",
      name: "Opening",
      startAt: base.startAt!,
      endAt: base.endAt!,
      roomId: "room-a",
      roles: ["mc"],
      roleRequirements: [{ role: "mc", seniority: "senior" as const, attendanceMode: "physical" as const }],
    };
    const members = [
      {
        userId: "junior",
        displayName: "Junior",
        roles: ["mc"],
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
        seniority: "junior" as const,
        attendanceMode: "physical" as const,
      },
      {
        userId: "senior",
        displayName: "Senior",
        roles: ["mc"],
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
        seniority: "senior" as const,
        attendanceMode: "physical" as const,
      },
    ];
    expect(allocateAgendaRoles([block], members, [], [], "fair", "random").assignments[0]?.userId).toBe("senior");
  });
  it("allocates reproducibly around pins and balances duration", () => {
    const blocks = [
      {
        id: "a",
        name: "Opening",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        roles: ["mc"],
        roleRequirements: [],
      },
      {
        id: "b",
        name: "Lunch",
        startAt: "2026-12-01T10:00:00.000Z",
        endAt: "2026-12-01T11:00:00.000Z",
        roomId: null,
        roles: ["mc"],
        roleRequirements: [],
      },
    ];
    const members = ["one", "two"].map((userId) => ({
      userId,
      displayName: userId,
      roles: ["mc"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
      seniority: "junior" as const,
      attendanceMode: "physical" as const,
    }));
    const pinned = [{ blockId: "a", role: "mc", userId: "one", pinned: true }];
    const result = allocateAgendaRoles(blocks, members, pinned, [], "seed", "balanced");
    expect(result.assignments).toEqual([...pinned, { blockId: "b", role: "mc", userId: "two", pinned: false }]);
    expect(result).toEqual(allocateAgendaRoles(blocks, members, pinned, [], "seed", "balanced"));
  });
});
