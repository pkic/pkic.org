import { seedStaffingPositionAssignment } from "./helpers/agenda-staffing";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { createAgendaRoom, createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import {
  agendaScheduleProposalSchema,
  agendaScheduleReviewSchema,
} from "../assets/shared/schemas/event-agenda-schedule";
let eventId: string, adminId: string, headers: Record<string, string>;
let proposal: ReturnType<typeof agendaScheduleProposalSchema.parse>;
const path = "/api/v1/events/pqc-2026/agenda/schedule";
const post = (suffix: string, body: unknown, auth = headers) =>
  callApi(env, `${path}${suffix}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
beforeEach(async () => {
  await resetDb();
  ({ eventId } = await seedEventAndAdmin(env.DB));
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
  adminId = admin.id;
  const token = await createAdminSession(env.DB, adminId, "schedule-route");
  headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: 0,
    name: "Hall",
    capacity: 100,
    setupMinutes: 0,
  });
  const roomId = snapshot.rooms[0].id;
  for (const hour of [10, 11])
    snapshot = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: snapshot.revision,
        title: `Talk ${hour}`,
        roomId,
        startAt: `2026-12-01T${hour}:00:00.000Z`,
        endAt: `2026-12-01T${hour}:30:00.000Z`,
      }),
    );
  proposal = agendaScheduleProposalSchema.parse({
    expectedRevision: snapshot.revision,
    changes: snapshot.occurrences.map((item, index) => ({
      id: item.id,
      roomId,
      additionalRoomIds: [],
      startAt: `2026-12-01T${index === 0 ? 11 : 10}:00:00.000Z`,
      endAt: `2026-12-01T${index === 0 ? 11 : 10}:30:00.000Z`,
    })),
  });
});
describe("reviewed atomic agenda scheduling", () => {
  it("returns canonical before/after ordering without writing, then applies the whole schedule once", async () => {
    const response = await post("/reviews", proposal);
    expect(response.status, await response.clone().text()).toBe(200);
    const review = agendaScheduleReviewSchema.parse(await response.json());
    expect(review.affected).toHaveLength(2);
    expect(review.affected.map((item) => [item.beforeOrder, item.afterOrder])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect((await getAgenda(env.DB, eventId, "pqc-2026")).revision).toBe(proposal.expectedRevision);
    const applied = await post("", { ...proposal, reviewHash: review.reviewHash });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const snapshot = agendaSnapshotSchema.parse(await applied.json());
    expect(snapshot.revision).toBe(proposal.expectedRevision + 1);
    expect(snapshot.occurrences.find((item) => item.id === proposal.changes[0].id)?.startAt).toBe(
      proposal.changes[0].startAt,
    );
  });
  it("refuses altered review contents and leaves every session unchanged", async () => {
    const reviewed = agendaScheduleReviewSchema.parse(await (await post("/reviews", proposal)).json());
    const changed = {
      ...proposal,
      changes: proposal.changes.map((item) => ({
        ...item,
        startAt: item.startAt!.replace(":00:", ":05:"),
        endAt: item.endAt!.replace(":30:", ":35:"),
      })),
      reviewHash: reviewed.reviewHash,
    };
    expect((await post("", changed)).status).toBe(409);
    expect((await getAgenda(env.DB, eventId, "pqc-2026")).revision).toBe(proposal.expectedRevision);
  });
  it("accepts one concurrent apply and atomically rejects the stale second proposal", async () => {
    const review = agendaScheduleReviewSchema.parse(await (await post("/reviews", proposal)).json());
    const replies = await Promise.all([
      post("", { ...proposal, reviewHash: review.reviewHash }),
      post("", { ...proposal, reviewHash: review.reviewHash }),
    ]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect((await getAgenda(env.DB, eventId, "pqc-2026")).revision).toBe(proposal.expectedRevision + 1);
  });
  it("rejects a conflicting bulk move without partial scheduling", async () => {
    const conflicting = {
      ...proposal,
      changes: proposal.changes.map((item) => ({
        ...item,
        startAt: "2026-12-01T10:00:00.000Z",
        endAt: "2026-12-01T10:30:00.000Z",
      })),
    };
    expect((await post("/reviews", conflicting)).status).toBe(409);
    expect((await getAgenda(env.DB, eventId, "pqc-2026")).revision).toBe(proposal.expectedRevision);
  });
  it("requires authentication and rejects duplicate or oversized collections through the mounted contract", async () => {
    expect((await post("/reviews", proposal, { "content-type": "application/json" })).status).toBe(401);
    expect((await post("/reviews", { ...proposal, changes: [proposal.changes[0], proposal.changes[0]] })).status).toBe(
      400,
    );
    expect(
      (
        await post("/reviews", {
          ...proposal,
          changes: Array.from({ length: 101 }, () => ({ ...proposal.changes[0], id: crypto.randomUUID() })),
        })
      ).status,
    ).toBe(400);
  });
});

it("reviews and atomically relocates an explicitly placed physical speaker with the primary room", async () => {
  const before = await getAgenda(env.DB, eventId, "pqc-2026");
  const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: before.revision,
    name: "Second hall",
    capacity: 100,
    setupMinutes: 0,
  });
  const occurrence = snapshot.occurrences[0];
  const roomId = snapshot.rooms.find((room) => room.id !== occurrence.roomId)!.id;
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,'speaker','physical',?)",
  )
    .bind(occurrence.id, adminId, occurrence.roomId)
    .run();
  const move = agendaScheduleProposalSchema.parse({
    expectedRevision: snapshot.revision,
    changes: [
      { id: occurrence.id, startAt: occurrence.startAt, endAt: occurrence.endAt, roomId, additionalRoomIds: [] },
    ],
  });
  const response = await post("/reviews", move);
  expect(response.status, await response.clone().text()).toBe(200);
  const review = agendaScheduleReviewSchema.parse(await response.json());
  expect(review.affected[0].before.speakers[0].roomId).toBe(occurrence.roomId);
  expect(review.affected[0].after.speakers[0].roomId).toBe(roomId);
  expect((await getAgenda(env.DB, eventId, "pqc-2026")).occurrences[0].speakers[0].roomId).toBe(occurrence.roomId);
  const applied = await post("", { ...move, reviewHash: review.reviewHash });
  expect(applied.status, await applied.clone().text()).toBe(200);
  const after = agendaSnapshotSchema.parse(await applied.json());
  expect(after.revision).toBe(snapshot.revision + 1);
  expect(after.occurrences.find((item) => item.id === occurrence.id)!.speakers[0].roomId).toBe(roomId);
});

it("moves primary speaker placements on a room-only PATCH and preserves credit roles", async () => {
  const before = await getAgenda(env.DB, eventId, "pqc-2026");
  const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: before.revision,
    name: "Other hall",
    capacity: 100,
    setupMinutes: 0,
  });
  const occurrence = snapshot.occurrences[0];
  const roomId = snapshot.rooms.find((room) => room.id !== occurrence.roomId)!.id;
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,'panelist','physical',?)",
  )
    .bind(occurrence.id, adminId, occurrence.roomId)
    .run();
  const response = await callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrence.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ expectedRevision: snapshot.revision, roomId }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const after = agendaSnapshotSchema.parse(await response.json());
  expect(after.occurrences.find((item) => item.id === occurrence.id)!.speakers[0]).toMatchObject({
    userId: adminId,
    role: "panelist",
    attendanceMode: "physical",
    roomId,
  });
});

it("refuses a review that abandons a deliberate physical speaker room", async () => {
  const before = await getAgenda(env.DB, eventId, "pqc-2026");
  const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: before.revision,
    name: "Reserved overflow",
    capacity: 100,
    setupMinutes: 0,
  });
  const occurrence = snapshot.occurrences[0];
  const overflow = snapshot.rooms.find((room) => room.id !== occurrence.roomId)!.id;
  await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
    .bind(occurrence.id, overflow)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,'speaker','physical',?)",
  )
    .bind(occurrence.id, adminId, overflow)
    .run();
  const change = {
    id: occurrence.id,
    roomId: occurrence.roomId,
    additionalRoomIds: [],
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
  };
  const refused = await post("/reviews", { expectedRevision: snapshot.revision, changes: [change] });
  expect(refused.status).toBe(409);
  expect((await getAgenda(env.DB, eventId, "pqc-2026")).revision).toBe(snapshot.revision);
  const repaired = await post("/reviews", {
    expectedRevision: snapshot.revision,
    changes: [
      { ...change, speakerPlacements: { [adminId]: { attendanceMode: "physical", roomId: occurrence.roomId } } },
    ],
  });
  expect(repaired.status, await repaired.clone().text()).toBe(200);
});

it("restores exact deliberate placements when reversing a primary and additional room change", async () => {
  const before = await getAgenda(env.DB, eventId, "pqc-2026");
  const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: before.revision,
    name: "Reserved overflow",
    capacity: 100,
    setupMinutes: 0,
  });
  const occurrence = snapshot.occurrences[0];
  const overflow = snapshot.rooms.find((room) => room.id !== occurrence.roomId)!.id;
  await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
    .bind(occurrence.id, overflow)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,'panelist','physical',?)",
  )
    .bind(occurrence.id, adminId, overflow)
    .run();
  const original = (await getAgenda(env.DB, eventId, "pqc-2026")).occurrences.find(
    (item) => item.id === occurrence.id,
  )!;
  const move = {
    expectedRevision: snapshot.revision,
    changes: [
      {
        id: occurrence.id,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        roomId: overflow,
        additionalRoomIds: [occurrence.roomId!],
      },
    ],
  };
  const reviewed = agendaScheduleReviewSchema.parse(await (await post("/reviews", move)).json());
  const applied = await post("", { ...move, reviewHash: reviewed.reviewHash });
  expect(applied.status, await applied.clone().text()).toBe(200);
  const next = agendaSnapshotSchema.parse(await applied.json());
  const reverse = {
    expectedRevision: next.revision,
    changes: [
      {
        id: occurrence.id,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        roomId: occurrence.roomId,
        additionalRoomIds: [overflow],
        speakerPlacements: { [adminId]: { attendanceMode: "physical", roomId: overflow } },
      },
    ],
  };
  const reverseReview = agendaScheduleReviewSchema.parse(await (await post("/reviews", reverse)).json());
  const undone = await post("", { ...reverse, reviewHash: reverseReview.reviewHash });
  expect(undone.status, await undone.clone().text()).toBe(200);
  expect(
    agendaSnapshotSchema.parse(await undone.json()).occurrences.find((item) => item.id === occurrence.id)!.speakers,
  ).toEqual(original.speakers);
});

it("uses actual speaker rooms for travel and refuses the superseded swap route", async () => {
  const before = await getAgenda(env.DB, eventId, "pqc-2026");
  const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: before.revision,
    name: "Overflow",
    capacity: 100,
    setupMinutes: 0,
  });
  const overflow = snapshot.rooms.find((room) => room.id !== snapshot.occurrences[0].roomId)!.id;
  await env.DB.prepare("UPDATE event_agenda_state SET travel_minutes=15 WHERE event_id=?").bind(eventId).run();
  for (const [index, occurrence] of snapshot.occurrences.entries()) {
    if (index === 0)
      await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
        .bind(occurrence.id, overflow)
        .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,'speaker','physical',?)",
    )
      .bind(occurrence.id, adminId, index === 0 ? overflow : occurrence.roomId)
      .run();
  }
  const second = snapshot.occurrences[1];
  const move = {
    expectedRevision: snapshot.revision,
    changes: [
      {
        id: second.id,
        roomId: second.roomId,
        additionalRoomIds: [],
        startAt: "2026-12-01T10:35:00.000Z",
        endAt: "2026-12-01T11:05:00.000Z",
      },
    ],
  };
  const refused = await post("/reviews", move);
  expect(refused.status).toBe(409);
  expect(
    (
      await callApi(env, "/api/v1/events/pqc-2026/agenda/swaps", {
        method: "POST",
        headers,
        body: JSON.stringify({
          expectedRevision: snapshot.revision,
          firstId: snapshot.occurrences[0].id,
          secondId: second.id,
        }),
      })
    ).status,
  ).toBe(404);
});

it("promotes an existing additional room with a room-only PATCH without losing reservations", async () => {
  const before = await getAgenda(env.DB, eventId, "pqc-2026");
  const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: before.revision,
    name: "Overflow",
    capacity: 100,
    setupMinutes: 0,
  });
  const occurrence = snapshot.occurrences[0];
  const overflow = snapshot.rooms.find((room) => room.id !== occurrence.roomId)!.id;
  await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
    .bind(occurrence.id, overflow)
    .run();
  const response = await callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrence.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ expectedRevision: snapshot.revision, roomId: overflow }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(
    agendaSnapshotSchema.parse(await response.json()).occurrences.find((item) => item.id === occurrence.id),
  ).toMatchObject({ roomId: overflow, additionalRoomIds: [occurrence.roomId] });
});

it("does not invent physical travel for a remote shift duty and still refuses overlapping commitments", async () => {
  const before = await getAgenda(env.DB, eventId, "pqc-2026");
  const snapshot = await createAgendaRoom(env.DB, eventId, "pqc-2026", {
    expectedRevision: before.revision,
    name: "Duty room",
    capacity: 100,
    setupMinutes: 0,
  });
  const occurrence = snapshot.occurrences[0];
  const otherRoom = snapshot.rooms.find((room) => room.id !== occurrence.roomId)!.id;
  await env.DB.prepare("UPDATE event_agenda_state SET travel_minutes=15 WHERE event_id=?").bind(eventId).run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,'speaker','physical',?)",
  )
    .bind(occurrence.id, adminId, occurrence.roomId)
    .run();
  const shiftId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_agenda_shifts(id,event_id,name,start_at,end_at,room_id,roles_json) VALUES(?,?,'Remote questions','2026-12-01T09:25:00.000Z','2026-12-01T09:55:00.000Z',?,'[\"questions\"]')",
  )
    .bind(shiftId, eventId, otherRoom)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_role_members(event_id,user_id,roles_json,attendance_mode) VALUES(?,?,'[\"questions\"]','remote')",
  )
    .bind(eventId, adminId)
    .run();
  await seedStaffingPositionAssignment(env.DB, { eventId, shiftId, role: "questions", userId: adminId });
  const move = {
    expectedRevision: snapshot.revision,
    changes: [
      {
        id: occurrence.id,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        roomId: occurrence.roomId,
        additionalRoomIds: [],
      },
    ],
  };
  const response = await post("/reviews", move);
  expect(response.status, await response.clone().text()).toBe(200);
  const reviewed = agendaScheduleReviewSchema.parse(await response.json());
  const applied = await post("", { ...move, reviewHash: reviewed.reviewHash });
  expect(applied.status, await applied.clone().text()).toBe(200);
  const current = agendaSnapshotSchema.parse(await applied.json());
  const overlap = await post("/reviews", {
    expectedRevision: current.revision,
    changes: [{ ...move.changes[0], startAt: "2026-12-01T09:50:00.000Z", endAt: "2026-12-01T10:20:00.000Z" }],
  });
  expect(overlap.status).toBe(409);
});
