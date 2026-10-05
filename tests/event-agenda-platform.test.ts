import { reviewAgendaSchedule, applyAgendaSchedule } from "../functions/_lib/services/event-agenda/schedule";
import { USER_SESSION_COOKIE_NAME } from "../functions/_lib/auth/session-cookies";
import { updateAgendaRoom } from "../functions/_lib/services/event-agenda/rooms";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { staffingFixture } from "./helpers/agenda-staffing";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import {
  createAgendaRoom,
  createAgendaOccurrence,
  patchAgendaOccurrence,
  saveAgendaStaffing,
  publishAgenda,
} from "../functions/_lib/services/event-agenda/mutations";
import { importAgenda } from "../functions/_lib/services/event-agenda/import";
import { agendaConflicts, allocateAgendaRoles } from "../assets/shared/event-agenda-policy";
import { agendaOccurrenceCreateSchema, agendaAssignmentSchema } from "../assets/shared/schemas/event-agenda";

describe("agenda platform", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("tracks approval changes in every reserved room without duplicating canonical occurrences", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    let snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      name: "Primary",
      capacity: 20,
      setupMinutes: 0,
    });
    const primary = snapshot.rooms[0].id;
    snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 1,
      name: "Overflow",
      capacity: 10,
      setupMinutes: 0,
    });
    const overflow = snapshot.rooms.find((room) => room.name === "Overflow")!.id;
    snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 2,
        title: "Multi-room talk",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: primary,
        additionalRoomIds: [overflow],
      }),
    );
    const id = snapshot.occurrences[0].id;
    snapshot = await publishAgenda(env.DB, eventId, "pqc-2026", 3, admin.id);
    const requests = await queryAll<{ resource_id: string; revision: number; reason_code: string; status: string }>(
      env.DB,
      "SELECT resource_id,revision,reason_code,status FROM site_publication_requests WHERE resource_type='event_agenda' AND resource_id=?",
      [eventId],
    );
    expect(requests).toEqual([{ resource_id: eventId, revision: 4, reason_code: "agenda_approved", status: "queued" }]);
    const token = await createAdminSession(env.DB, admin.id, "publication-status");
    const delivery = await callApi(env, "/api/v1/events/pqc-2026/agenda/publication-requests?limit=1&sort=-sequence", {
      headers: { Cookie: `${USER_SESSION_COOKIE_NAME}=${token}` },
    });
    expect(delivery.status).toBe(200);
    const queued = (await delivery.json()) as {
      requests: Array<{ revision: number; status: string }>;
      page: { total: number };
    };
    expect(queued.requests).toHaveLength(1);
    expect(queued.requests[0]).toMatchObject({ revision: 4, status: "queued" });
    expect(queued.page.total).toBe(1);
    expect(JSON.stringify(queued)).not.toContain("leaseToken");

    expect(snapshot.occurrences).toHaveLength(1);
    expect(snapshot.occurrences[0]).toMatchObject({ additionalRoomIds: [overflow], publicationStatus: "published" });
    snapshot = await updateAgendaRoom(
      env.DB,
      eventId,
      "pqc-2026",
      overflow,
      { expectedRevision: 4, name: "Renamed overflow", capacity: 10, setupMinutes: 0 },
      admin.id,
    );
    expect(snapshot.occurrences[0].publicationStatus).toBe("changed");
    snapshot = await updateAgendaRoom(
      env.DB,
      eventId,
      "pqc-2026",
      overflow,
      { expectedRevision: 5, name: "Overflow", capacity: 10, setupMinutes: 0 },
      admin.id,
    );
    expect(snapshot.occurrences[0].publicationStatus).toBe("published");
    snapshot = await patchAgendaOccurrence(env.DB, eventId, "pqc-2026", id, {
      expectedRevision: 6,
      additionalRoomIds: [],
    });
    expect(snapshot.occurrences[0].publicationStatus).toBe("changed");
  });
  it("freezes only public block duty display while retaining private allocation controls in the portal", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    await env.DB.prepare("UPDATE users SET preferred_name=? WHERE id=?").bind("Synthetic Host", admin.id).run();
    const startAt = "2026-12-01T09:00:00.000Z",
      endAt = "2026-12-01T10:00:00.000Z";
    await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({ expectedRevision: 0, title: "Public talk", startAt, endAt, roomId: null }),
    );
    const blockId = crypto.randomUUID();
    const staffing = staffingFixture({
      expectedRevision: 1,
      blocks: [
        { id: blockId, name: "Morning block", startAt, endAt, roomId: null, roles: ["mc"], roleRequirements: [] },
      ],
      roleMembers: [
        {
          userId: admin.id,
          displayName: "Synthetic Host",
          roles: ["mc"],
          availableFrom: null,
          availableUntil: null,
          maxMinutes: null,
          seniority: "senior",
          attendanceMode: "physical",
        },
      ],
      assignments: [{ blockId, role: "mc", userId: admin.id, pinned: true }],
    });
    staffing.staffingRoles[0].showOnAgenda = true;
    await saveAgendaStaffing(env.DB, eventId, "pqc-2026", staffing, admin.id);
    await publishAgenda(env.DB, eventId, "pqc-2026", 2, admin.id);
    const [row] = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?",
      [eventId],
    );
    const approved = JSON.parse(row.snapshot_json);
    expect(approved.displayRoles).toMatchObject([
      { name: "Morning block", duties: [{ role: "mc", displayName: "Synthetic Host" }] },
    ]);
    expect(approved.assignments).toEqual([]);
    expect(approved.roleMembers).toEqual([]);
    expect(JSON.stringify(approved.displayRoles)).not.toMatch(/pinned|maxMinutes|userId/);
  });
  it("regenerates selected blocks through the API without filling or pinning other blocks", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const blocks = [9, 10, 11].map((hour) => ({
      id: crypto.randomUUID(),
      name: `Block ${hour}`,
      startAt: `2026-12-01T${String(hour).padStart(2, "0")}:00:00.000Z`,
      endAt: `2026-12-01T${String(hour + 1).padStart(2, "0")}:00:00.000Z`,
      roomId: null,
      roles: ["mc"],
      roleRequirements: [],
    }));
    await saveAgendaStaffing(
      env.DB,
      eventId,
      "pqc-2026",
      staffingFixture({
        expectedRevision: 0,
        blocks,
        roleMembers: [
          {
            userId: admin.id,
            displayName: "Host",
            roles: ["mc"],
            availableFrom: null,
            availableUntil: null,
            maxMinutes: null,
            seniority: "senior",
            attendanceMode: "physical",
          },
        ],
        assignments: [{ blockId: blocks[0].id, role: "mc", userId: admin.id, pinned: false }],
      }),
      admin.id,
    );
    const token = await createAdminSession(env.DB, admin.id, "selected-duty-test");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const response = await callApi(env, "/api/v1/events/pqc-2026/agenda/allocations", {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: 1, seed: "selected", strategy: "balanced", blockIds: [blocks[1].id] }),
    });
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as {
      revision: number;
      assignments: Array<{ blockId: string; pinned: boolean }>;
    };
    expect(snapshot.assignments).toHaveLength(2);
    expect(snapshot.assignments.find((assignment) => assignment.blockId === blocks[0].id)?.pinned).toBe(false);
    expect(snapshot.assignments.some((assignment) => assignment.blockId === blocks[2].id)).toBe(false);
    const [audit] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action='agenda.staffing.generated' AND entity_id=?",
      [eventId],
    );
    const recorded = Object.fromEntries(
      Object.entries(JSON.parse(audit.details_json) as Record<string, { to: unknown }>).map(([key, change]) => [
        key,
        change.to,
      ]),
    );
    expect(recorded).toMatchObject({
      seed: "selected",
      strategy: "balanced",
      selectedBlockIds: [blocks[1].id],
      fromRevision: 1,
      toRevision: 2,
    });
    const recordedAssignments = agendaAssignmentSchema.array().parse(recorded.assignments);
    expect(recordedAssignments).toHaveLength(snapshot.assignments.length);
    expect(recordedAssignments).toEqual(expect.arrayContaining(snapshot.assignments));

    const unknown = await callApi(env, "/api/v1/events/pqc-2026/agenda/allocations", {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: snapshot.revision, seed: "selected", blockIds: [crypto.randomUUID()] }),
    });
    expect(unknown.status).toBe(400);
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
  it("filters visibility and session type before paginating the compact table", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin.id, "agenda-filter-test");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    for (const [index, visibility, kind] of [
      [0, "public", "session"],
      [1, "private", "session"],
      [2, "private", "break"],
    ] as const) {
      await createAgendaOccurrence(
        env.DB,
        eventId,
        "pqc-2026",
        agendaOccurrenceCreateSchema.parse({
          expectedRevision: index,
          title: `${visibility} ${kind}`,
          startAt: null,
          endAt: null,
          roomId: null,
          visibility,
          kind,
          accessPolicy: index === 1 ? "invitation" : "open",
          speakerUserIds: index === 1 ? [admin.id] : [],
        }),
      );
    }
    const response = await callApi(
      env,
      `/api/v1/events/pqc-2026/agenda/occurrences?visibility=private&kind=session&limit=1&accessPolicy=invitation&speakerUserId=${admin.id}`,
      { headers },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      occurrences: [{ title: "private session" }],
      page: { total: 1, limit: 1 },
    });
    const excluded = await callApi(
      env,
      `/api/v1/events/pqc-2026/agenda/occurrences?accessPolicy=open&speakerUserId=${admin.id}`,
      { headers },
    );
    expect(excluded.status).toBe(200);
    expect(await excluded.json()).toMatchObject({ occurrences: [], page: { total: 0 } });
    const invalid = await callApi(env, "/api/v1/events/pqc-2026/agenda/occurrences?visibility=hidden", { headers });
    expect(invalid.status).toBe(400);
  });
  it("edits locations through guarded routes and rejects setup conflicts without changing the revision", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin.id, "agenda-room-edit");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    let snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      name: "Hall",
      capacity: 40,
      setupMinutes: 0,
    });
    const roomId = snapshot.rooms[0].id;
    for (let index = 0; index < 2; index++)
      snapshot = await createAgendaOccurrence(
        env.DB,
        eventId,
        "pqc-2026",
        agendaOccurrenceCreateSchema.parse({
          expectedRevision: snapshot.revision,
          title: `Talk ${index}`,
          startAt: `2026-12-01T${index ? "10" : "09"}:00:00.000Z`,
          endAt: `2026-12-01T${index ? "11" : "10"}:00:00.000Z`,
          roomId,
        }),
      );
    const update = (body: unknown) =>
      callApi(env, `/api/v1/events/pqc-2026/agenda/rooms/${roomId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
    const refused = await update({ expectedRevision: 3, name: "Renamed", capacity: 40, setupMinutes: 15 });
    expect(refused.status).toBe(409);
    expect(await queryAll(env.DB, "SELECT name,setup_minutes FROM event_agenda_rooms WHERE id=?", [roomId])).toEqual([
      { name: "Hall", setup_minutes: 0 },
    ]);
    const saved = await update({ expectedRevision: 3, name: "Main hall", capacity: 45, setupMinutes: 0 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ revision: 4, rooms: [{ name: "Main hall", capacity: 45 }] });
    const stale = await update({ expectedRevision: 3, name: "Stale", capacity: 45, setupMinutes: 0 });
    expect(stale.status).toBe(409);
  });
  it("preserves equipment requirements and rejects incompatible moves and room edits", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    let snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      name: "Equipped",
      capacity: 20,
      setupMinutes: 0,
      equipment: ["projector"],
    });
    const equippedId = snapshot.rooms[0].id;
    snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 1,
      name: "Other",
      capacity: 20,
      setupMinutes: 0,
      equipment: [],
    });
    const otherId = snapshot.rooms.find((room) => room.name === "Other")!.id;
    snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 2,
        title: "Demo",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: equippedId,
        requiredEquipment: ["Projector"],
      }),
    );
    const occurrence = snapshot.occurrences[0];
    expect(occurrence.requiredEquipment).toEqual(["projector"]);
    await expect(
      patchAgendaOccurrence(env.DB, eventId, "pqc-2026", occurrence.id, { expectedRevision: 3, roomId: otherId }),
    ).rejects.toMatchObject({ code: "AGENDA_SCHEDULE_CONFLICT" });
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin.id, "room-equipment-test");
    const refused = await callApi(env, `/api/v1/events/pqc-2026/agenda/rooms/${equippedId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: 3, name: "Equipped", capacity: 20, setupMinutes: 0, equipment: [] }),
    });
    expect(refused.status).toBe(409);
    expect(await queryAll(env.DB, "SELECT equipment_json FROM event_agenda_rooms WHERE id=?", [equippedId])).toEqual([
      { equipment_json: '["projector"]' },
    ]);
    expect(await queryAll(env.DB, "SELECT revision FROM event_agenda_state WHERE event_id=?", [eventId])).toEqual([
      { revision: 3 },
    ]);
  });
  it("requires sessions and setup to fit room opening periods", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      name: "Morning room",
      capacity: 20,
      setupMinutes: 15,
      availablePeriods: [{ startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T11:00:00.000Z" }],
    });
    const body = agendaOccurrenceCreateSchema.parse({
      expectedRevision: 1,
      title: "Demo",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
      roomId: snapshot.rooms[0].id,
    });
    await expect(createAgendaOccurrence(env.DB, eventId, "pqc-2026", body)).rejects.toMatchObject({
      code: "AGENDA_SCHEDULE_CONFLICT",
    });
    const saved = await createAgendaOccurrence(env.DB, eventId, "pqc-2026", {
      ...body,
      endAt: "2026-12-01T10:45:00.000Z",
    });
    expect(saved.revision).toBe(2);
    await expect(
      patchAgendaOccurrence(env.DB, eventId, "pqc-2026", saved.occurrences[0].id, {
        expectedRevision: 2,
        startAt: "2026-12-01T08:59:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "AGENDA_SCHEDULE_CONFLICT" });
  });
  it("reports per-session approval status independently of the event revision and filters before pagination", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin.id, "publication-status");
    const headers = { authorization: `Bearer ${token}` };
    let snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
      expectedRevision: 0,
      name: "Hall",
      capacity: 20,
      setupMinutes: 0,
    });
    const roomId = snapshot.rooms[0].id;
    snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 1,
        title: "Approved talk",
        speakerUserIds: [admin.id],
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId,
      }),
    );
    const occurrenceId = snapshot.occurrences[0].id;
    await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 2,
        title: "Backlog",
        startAt: null,
        endAt: null,
        roomId: null,
      }),
    );
    await seedApprovedSessionAppearances(env.DB, {
      occurrenceId,
      reviewerId: admin.id,
      appearances: [
        individualAppearanceFixture({
          userId: admin.id,
          displayName: "Approved individual speaker",
          approvedAt: "2026-10-04T00:00:00.000Z",
        }),
      ],
    });
    snapshot = await publishAgenda(env.DB, eventId, "pqc-2026", 3, admin.id);
    expect(snapshot.occurrences.find((row) => row.id === occurrenceId)?.publicationStatus).toBe("published");
    expect(snapshot.occurrences.find((row) => row.title === "Backlog")?.publicationStatus).toBe("unpublished");
    snapshot = await patchAgendaOccurrence(env.DB, eventId, "pqc-2026", occurrenceId, {
      expectedRevision: 4,
      title: "Changed title",
    });
    expect(snapshot.occurrences.find((row) => row.id === occurrenceId)?.publicationStatus).toBe("changed");
    const filtered = await callApi(
      env,
      "/api/v1/events/pqc-2026/agenda/occurrences?publicationStatus=changed&limit=1",
      { headers },
    );
    expect(filtered.status).toBe(200);
    expect(await filtered.json()).toMatchObject({
      occurrences: [{ id: occurrenceId, publicationStatus: "changed" }],
      page: { total: 1, limit: 1 },
    });
    snapshot = await patchAgendaOccurrence(env.DB, eventId, "pqc-2026", occurrenceId, {
      expectedRevision: 5,
      title: "Approved talk",
    });
    expect(snapshot.occurrences.find((row) => row.id === occurrenceId)?.publicationStatus).toBe("published");
    const [profile] = await queryAll<{ preferred_name: string | null }>(
      env.DB,
      "SELECT preferred_name FROM users WHERE id=?",
      [admin.id],
    );
    await env.DB.prepare("UPDATE users SET preferred_name=? WHERE id=?").bind("Updated speaker credit", admin.id).run();
    const changedCredit = await callApi(env, "/api/v1/events/pqc-2026/agenda/occurrences?publicationStatus=changed", {
      headers,
    });
    expect(changedCredit.status).toBe(200);
    expect(await changedCredit.json()).toMatchObject({
      occurrences: [
        { id: occurrenceId, publicationStatus: "changed", speakers: [{ displayName: "Updated speaker credit" }] },
      ],
      page: { total: 1 },
    });
    await env.DB.prepare("UPDATE users SET preferred_name=? WHERE id=?").bind(profile.preferred_name, admin.id).run();
    snapshot = await updateAgendaRoom(
      env.DB,
      eventId,
      "pqc-2026",
      roomId,
      { expectedRevision: 6, name: "Renamed hall", capacity: 20, setupMinutes: 0 },
      admin.id,
    );
    expect(snapshot.occurrences.find((row) => row.id === occurrenceId)?.publicationStatus).toBe("changed");
  });
  it("reads archive and promotion details only for the selected session page", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin.id, "bounded-agenda-page");
    const snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Other session",
        startAt: null,
        endAt: null,
        roomId: null,
      }),
    );
    const excludedId = snapshot.occurrences[0].id;
    await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 1,
        title: "Requested session",
        startAt: null,
        endAt: null,
        roomId: null,
      }),
    );
    await env.DB.prepare(
      "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
    )
      .bind(excludedId, '{"sessionKey":null}', admin.id, "2026-10-03T10:00:00.000Z")
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_promotion_copy(occurrence_id,copy_json,updated_by,updated_at) VALUES(?,?,?,?)",
    )
      .bind(excludedId, '{"title":null}', admin.id, "2026-10-03T10:00:00.000Z")
      .run();
    const page = await callApi(env, "/api/v1/events/pqc-2026/agenda/occurrences?q=Requested&limit=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({
      occurrences: [{ title: "Requested session" }],
      page: { total: 1, limit: 1 },
    });
  });
  it("guards room collisions, stale revisions, and reviewed atomic swaps", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
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
    const a = snapshot.occurrences.find((item) => item.id === first)!;
    const b = snapshot.occurrences.find((item) => item.id === second)!;
    const proposal = {
      expectedRevision: 3,
      changes: [
        {
          id: first,
          startAt: b.startAt,
          endAt: b.endAt,
          roomId: b.roomId,
          additionalRoomIds: b.additionalRoomIds ?? [],
        },
        {
          id: second,
          startAt: a.startAt,
          endAt: a.endAt,
          roomId: a.roomId,
          additionalRoomIds: a.additionalRoomIds ?? [],
        },
      ],
    };
    const review = await reviewAgendaSchedule(env.DB, eventId, "pqc-2026", proposal, admin.id);
    snapshot = await applyAgendaSchedule(
      env.DB,
      eventId,
      "pqc-2026",
      { ...proposal, reviewHash: review.reviewHash },
      admin.id,
    );
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
    expect(imported.agenda.occurrences[0]).toMatchObject({
      presentationUrl: "/events/slides.pdf",
      recordingUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
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
          presentationUrl: null,
          recordingUrl: null,
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
          "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
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
    await saveAgendaStaffing(
      env.DB,
      eventId,
      "pqc-2026",
      staffingFixture({
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
      }),
    );
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
    expect(result.assignments).toEqual([
      ...pinned,
      { blockId: "b", role: "mc", userId: "two", pinned: false, origin: "generated" },
    ]);
    expect(result).toEqual(allocateAgendaRoles(blocks, members, pinned, [], "seed", "balanced"));
  });
});
