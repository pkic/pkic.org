import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  agendaBlockSchema,
  agendaOccurrenceListSchema,
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import { agendaDisplayRoles } from "../assets/shared/event-agenda-display-roles";
import { operationalPeople } from "../functions/_lib/services/event-agenda/operational-people";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { staffingFixture } from "./helpers/agenda-staffing";
import { resetDb } from "./helpers/reset-db";

const track = "Trust & identity";
const day = "2026-12-01";
const at = (time: string) => `${day}T${time}:00.000Z`;
let eventId: string, person: string, token: string;
let roomA: string, roomB: string, first: string, second: string, otherTrack: string, untracked: string;

function request(path = "", body?: unknown, method = body ? "POST" : "GET") {
  return callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function current() {
  const response = await request();
  expect(response.status).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}
function input(
  options: { revision?: number; roomId?: string | null; mode?: "physical" | "remote"; pin?: boolean } = {},
) {
  return staffingFixture({
    expectedRevision: options.revision ?? 0,
    blocks: [
      {
        id: "track-host",
        name: "Track host",
        startAt: at("09:00"),
        endAt: at("10:30"),
        roomId: options.roomId ?? null,
        track,
        roles: ["mc"],
      },
    ],
    roleMembers: [
      {
        userId: person,
        displayName: "Synthetic host",
        roles: ["mc"],
        availableFrom: null,
        availableUntil: null,
        maxMinutes: 120,
        seniority: "senior",
        attendanceMode: options.mode ?? "physical",
      },
    ],
    assignments: options.pin
      ? [{ blockId: "track-host", role: "mc", userId: person, pinned: true, origin: "manual" }]
      : [],
  });
}
async function save(body = input()) {
  const response = await request("/staffing", body);
  expect(response.status).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}
async function generate(revision: number) {
  const response = await request("/allocations", {
    expectedRevision: revision,
    seed: "authored-track",
    strategy: "balanced",
  });
  expect(response.status).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}
async function patch(id: string, body: z.input<typeof agendaOccurrencePatchSchema>) {
  return request(`/occurrences/${id}`, agendaOccurrencePatchSchema.parse(body), "PATCH");
}
async function refusal(response: Response, code: string) {
  expect(response.status).toBe(409);
  expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe(code);
}

beforeEach(async () => {
  await resetDb();
  ({ eventId } = await seedEventAndAdmin(env.DB));
  person = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
  await env.DB.prepare("UPDATE users SET first_name='Synthetic',last_name='host' WHERE id=?").bind(person).run();
  token = await createAdminSession(env.DB, person, "track-staffing");
  [roomA, roomB, first, second, otherTrack, untracked] = Array.from({ length: 6 }, () => crypto.randomUUID());
  await env.DB.batch([
    ...[roomA, roomB].map((id, index) =>
      env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,30)").bind(
        id,
        eventId,
        `Room ${index + 1}`,
      ),
    ),
    ...[
      { id: first, room: roomA, track, start: "09:00", end: "09:30" },
      { id: second, room: roomB, track, start: "09:40", end: "10:10" },
      { id: otherTrack, room: roomB, track: "Cryptography", start: "09:00", end: "09:30" },
      { id: untracked, room: roomA, track: null, start: "09:30", end: "09:40" },
    ].map((item) =>
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id,track) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        item.id,
        eventId,
        `Synthetic ${item.track ?? "untracked"}`,
        at(item.start),
        at(item.end),
        item.room,
        item.track,
      ),
    ),
  ]);
});

describe("Authored track-scoped staffing", () => {
  it("saves, regenerates and audits a track-only duty across rooms without counting unrelated occurrences", async () => {
    const body = input();
    body.blocks[0].track = ` ${track} `;
    const saved = await save(body);
    expect(saved.blocks[0]).toMatchObject({ roomId: null, track });
    const allocated = await generate(saved.revision);
    expect(allocated.assignments).toHaveLength(1);
    expect(allocated.assignments[0]).toMatchObject({ userId: person, origin: "generated", pinned: false });
    expect(operationalPeople(allocated)).toEqual([
      {
        occurrence_id: first,
        user_id: person,
        attendance_mode: "physical",
        room_id: roomA,
        sources: ["position:track-host:mc:position:mc"],
      },
      {
        occurrence_id: second,
        user_id: person,
        attendance_mode: "physical",
        room_id: roomB,
        sources: ["position:track-host:mc:position:mc"],
      },
    ]);
    const repeated = await generate(allocated.revision);
    expect(repeated.assignments).toEqual(allocated.assignments);
    expect(repeated.staffingReport?.people[0].minutes).toBe(90);
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE entity_id=? AND action='agenda.staffing.generated' ORDER BY created_at,id LIMIT 1",
    )
      .bind(eventId)
      .first<{ details_json: string }>();
    const provenance = z
      .object({
        blocks: z.object({
          to: z.array(
            z.object(agendaBlockSchema.shape).pick({ id: true, startAt: true, endAt: true, roomId: true, track: true }),
          ),
        }),
      })
      .parse(JSON.parse(audit!.details_json));
    expect(provenance.blocks.to[0]).toMatchObject({ id: "track-host", roomId: null, track });
    const grants = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM permission_grants WHERE user_id=? AND context_type='event' AND context_id=?",
    )
      .bind(person, eventId)
      .first<{ count: number }>();
    // The existing administrator role grants authority; duties create no permission grants.
    expect(grants?.count).toBe(0);
  });

  it("intersects room and track, includes an explicit reserved secondary room and excludes private-only display", async () => {
    await env.DB.prepare("DELETE FROM event_agenda_occurrences WHERE id=?").bind(otherTrack).run();
    const moved = await patch(first, { expectedRevision: 0, additionalRoomIds: [roomB] });
    expect(moved.status).toBe(200);
    const saved = await save(input({ revision: 1, roomId: roomB, pin: true }));
    expect(operationalPeople(saved).map((row) => [row.occurrence_id, row.room_id])).toEqual([
      [first, roomB],
      [second, roomB],
    ]);
    const display = { ...saved, staffingRoles: saved.staffingRoles.map((role) => ({ ...role, showOnAgenda: true })) };
    expect(agendaDisplayRoles(display, day, true)).toMatchObject([
      { locationId: roomB, track, duties: [{ displayName: "Synthetic" }] },
    ]);
    const privateOnly = {
      ...display,
      occurrences: display.occurrences.map((item) =>
        item.track === track ? { ...item, visibility: "private" as const } : item,
      ),
    };
    expect(agendaDisplayRoles(privateOnly, day, true)).toEqual([]);
    const roomAOnly = { ...saved, blocks: saved.blocks.map((block) => ({ ...block, roomId: roomA })) };
    expect(operationalPeople(roomAOnly).map((row) => row.occurrence_id)).toEqual([first]);
  });

  it("retains the authored room scope when a normalized post leaves its physical location unspecified", async () => {
    await env.DB.prepare("DELETE FROM event_agenda_occurrences WHERE id=?").bind(otherTrack).run();
    expect((await patch(second, { expectedRevision: 0, startAt: at("09:10"), endAt: at("09:40") })).status).toBe(200);
    const body = input({ revision: 1, roomId: roomA, pin: true });
    body.staffingPosts = [{ id: "host-post", name: "Host post", roomId: null }];
    body.staffingRequirements[0].postId = "host-post";
    body.assignments[0].postId = "host-post";
    const saved = await save(body);
    expect(operationalPeople(saved).map((row) => [row.occurrence_id, row.room_id])).toEqual([[first, roomA]]);
    expect(saved.assignments[0]).toMatchObject({ pinned: true, postId: "host-post" });
  });

  it("keeps missing and null scope unfiltered, and rejects unknown or malformed authored tracks without writing", async () => {
    const malformed = input();
    malformed.blocks[0].track = " ";
    expect((await request("/staffing", malformed)).status).toBe(400);
    const unknown = input();
    unknown.blocks[0].track = "Another event's track";
    const response = await request("/staffing", unknown);
    expect(response.status).toBe(422);
    expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("AGENDA_BLOCK_TRACK");
    expect((await current()).revision).toBe(0);
    expect((await current()).blocks).toEqual([]);
    const allTracks = input({ mode: "remote", pin: true });
    delete allTracks.blocks[0].track;
    let saved = await save(allTracks);
    expect(saved.blocks[0].track).toBeUndefined();
    expect(
      operationalPeople(saved)
        .map((row) => row.occurrence_id)
        .sort(),
    ).toEqual([first, second, otherTrack, untracked].sort());
    allTracks.expectedRevision = saved.revision;
    allTracks.blocks[0].track = null;
    saved = await save(allTracks);
    expect(operationalPeople(saved)).toHaveLength(4);
  });

  it("explains physical parallel-room and travel shortfalls, permits remote coverage and retains a physical pin refusal", async () => {
    // Keep the unrelated room reservation valid while the two covered track sessions overlap across rooms.
    await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=?,end_at=? WHERE id=?")
      .bind(at("10:10"), at("10:30"), otherTrack)
      .run();
    const parallel = await patch(second, { expectedRevision: 0, startAt: at("09:10"), endAt: at("09:40") });
    expect(parallel.status).toBe(200);
    const saved = await save(input({ revision: 1 }));
    const allocated = await generate(saved.revision);
    expect(allocated.assignments).toEqual([]);
    expect(allocated.staffingReport?.uncovered[0]).toMatchObject({
      eligiblePeople: 0,
      reasons: [{ reason: "conflict", people: 1 }],
    });
    await refusal(
      await request("/staffing", input({ revision: allocated.revision, pin: true })),
      "AGENDA_ASSIGNMENT_OVERLAP",
    );
    expect((await current()).revision).toBe(allocated.revision);
    const remote = await save(input({ revision: allocated.revision, mode: "remote", pin: true }));
    expect(operationalPeople(remote).map((row) => row.room_id)).toEqual([null, null]);
    // Another track cannot erase whole-block talk conflicts, even for a remote host.
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode) VALUES(?,?,'speaker','remote')",
    )
      .bind(otherTrack, person)
      .run();
    await refusal(
      await request("/staffing", input({ revision: remote.revision, mode: "remote", pin: true })),
      "AGENDA_ASSIGNMENT_OVERLAP",
    );
  });

  it("uses the same physical travel buffer for a track crossing rooms", async () => {
    await env.DB.prepare("INSERT INTO event_agenda_state(event_id,revision,travel_minutes,updated_at) VALUES(?,0,15,?)")
      .bind(eventId, nowIso())
      .run();
    const saved = await save(input());
    const blocked = await generate(saved.revision);
    expect(blocked.assignments).toEqual([]);
    expect(blocked.staffingReport?.uncovered[0].reasons).toEqual([{ reason: "conflict", people: 1 }]);
    await refusal(
      await request("/staffing", input({ revision: blocked.revision, pin: true })),
      "AGENDA_ASSIGNMENT_OVERLAP",
    );
    const moved = await patch(second, { expectedRevision: blocked.revision, startAt: at("09:45"), endAt: at("10:15") });
    expect(moved.status).toBe(200);
    const ready = agendaSnapshotSchema.parse(await moved.json());
    expect((await generate(ready.revision)).assignments).toHaveLength(1);
  });

  it("atomically refuses a later occurrence track change that makes an existing physical duty parallel", async () => {
    const saved = await save(input({ pin: true }));
    const rejected = await patch(otherTrack, { expectedRevision: saved.revision, track });
    await refusal(rejected, "AGENDA_SCHEDULE_CONFLICT");
    const unchanged = await current();
    expect(unchanged.revision).toBe(saved.revision);
    expect(unchanged.assignments).toEqual(saved.assignments);
    expect(unchanged.occurrences.find((item) => item.id === otherTrack)?.track).toBe("Cryptography");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_schedule_guards WHERE event_id=?")
        .bind(eventId)
        .first(),
    ).toEqual({ count: 0 });
    // A deliberately changed draft fixture proves the list explanation uses the exact same guard predicate.
    await env.DB.prepare("UPDATE event_agenda_occurrences SET track=? WHERE id=?").bind(track, otherTrack).run();
    const listed = await request("/occurrences?limit=20");
    expect(listed.status).toBe(200);
    const rows = agendaOccurrenceListSchema.parse(await listed.json()).occurrences;
    expect(rows.find((item) => item.id === first)?.conflicts.categories).toContain("speaker_duty_conflict");
    expect(rows.find((item) => item.id === otherTrack)?.conflicts.categories).toContain("speaker_duty_conflict");
    expect(rows.find((item) => item.id === untracked)?.conflicts.categories).not.toContain("speaker_duty_conflict");
  });

  it("requires one physical location for a multi-room track occurrence while keeping remote coverage unchanged", async () => {
    await env.DB.prepare("DELETE FROM event_agenda_occurrences WHERE id=?").bind(otherTrack).run();
    expect((await patch(first, { expectedRevision: 0, additionalRoomIds: [roomB] })).status).toBe(200);
    await refusal(await request("/staffing", input({ revision: 1, pin: true })), "AGENDA_ASSIGNMENT_OVERLAP");
    expect((await current()).revision).toBe(1);
    const saved = await save(input({ revision: 1, mode: "remote", pin: true }));
    expect(operationalPeople(saved).every((person) => person.room_id === null)).toBe(true);
  });

  it("retains break-boundary review independently of the authored track", async () => {
    const coffee = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id,kind) VALUES(?,?,'Coffee',?,?,NULL,'break')",
    )
      .bind(coffee, eventId, at("10:30"), at("10:45"))
      .run();
    const body = input({ pin: true });
    body.blocks[0].boundaries = { endOccurrenceId: coffee };
    const saved = await save(body);
    expect(saved.staffingReport?.boundaryChanges).toEqual([]);
    const moved = await patch(coffee, { expectedRevision: saved.revision, startAt: at("10:45"), endAt: at("11:00") });
    expect(moved.status).toBe(200);
    const after = agendaSnapshotSchema.parse(await moved.json());
    expect(after.blocks[0]).toMatchObject({ track, endAt: at("10:30") });
    expect(after.staffingReport?.boundaryChanges).toEqual([
      { blockId: "track-host", boundary: "end", occurrenceId: coffee },
    ]);
  });
});
