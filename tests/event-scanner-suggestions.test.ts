import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { scannerSuggestions } from "../functions/_lib/services/event-participation/scanner-suggestions";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
const eventId = crypto.randomUUID(),
  operatorId = crypto.randomUUID(),
  otherId = crypto.randomUUID();
const roomA = crypto.randomUUID(),
  roomB = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  shiftId = crypto.randomUUID();
const now = new Date("2026-10-04T10:00:00.000Z");
let snapshot: Record<string, unknown>;
async function publish() {
  await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=?")
    .bind(JSON.stringify(snapshot), eventId)
    .run();
}
describe("Approved own-duty scanner suggestions", () => {
  beforeEach(async () => {
    await resetDb();
    for (const id of [operatorId, otherId])
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await grantAdministrator(env.DB, operatorId);
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'suggestions-test','Suggestions','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now.toISOString(), now.toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,1,1,?)",
    )
      .bind(eventId, now.toISOString())
      .run();
    snapshot = {
      timeZone: "UTC",
      rooms: [
        { id: roomA, name: "Room A" },
        { id: roomB, name: "Room B" },
      ],
      shifts: [
        {
          id: shiftId,
          name: "Morning",
          startAt: "2026-10-04T09:00:00.000Z",
          endAt: "2026-10-04T12:00:00.000Z",
          roomId: roomA,
        },
      ],
      assignments: [
        { shiftId, role: "mc", userId: operatorId },
        { shiftId, role: "remote-questions", userId: operatorId },
        { shiftId, role: "room-questions", userId: otherId },
      ],
      occurrences: [
        {
          id: sessionId,
          title: "Current session",
          startAt: "2026-10-04T09:30:00.000Z",
          endAt: "2026-10-04T10:30:00.000Z",
          roomId: roomA,
          additionalRoomIds: [roomB],
        },
      ],
    };
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, now.toISOString())
      .run();
  });
  it("reads historical approved duties with identical hints and leaves the stored approval untouched", async () => {
    const current = await scannerSuggestions(env.DB, eventId, operatorId, now);
    const { shifts, ...rest } = snapshot;
    const assignments = snapshot.assignments as Array<{ shiftId: string; role: string; userId: string }>;
    const legacy = {
      ...rest,
      blocks: shifts,
      assignments: assignments.map(({ shiftId, ...assignment }) => ({ ...assignment, blockId: shiftId })),
    };
    const bytes = JSON.stringify(legacy);
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=?")
      .bind(bytes, eventId)
      .run();
    const result = await scannerSuggestions(env.DB, eventId, operatorId, now);
    expect(result).toEqual(current);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      shiftId,
      shiftName: "Morning",
      roles: expect.arrayContaining(["mc", "remote-questions"]),
    });
    const stored = await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?")
      .bind(eventId)
      .first<{ snapshot_json: string }>();
    expect(stored?.snapshot_json).toBe(bytes);
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=?")
      .bind(JSON.stringify({ ...legacy, shifts }), eventId)
      .run();
    expect((await scannerSuggestions(env.DB, eventId, operatorId, now)).suggestions).toEqual([]);
  });
  it("returns only the operator's approved duties, deduplicating roles and matching additional rooms", async () => {
    await env.DB.prepare("UPDATE events SET timezone='Europe/Amsterdam' WHERE id=?").bind(eventId).run();
    (snapshot.shifts as Array<Record<string, unknown>>)[0]!.roomId = roomB;
    await publish();
    const result = await scannerSuggestions(env.DB, eventId, operatorId, now);
    expect(result.publishedRevision).toBe(1);
    expect(result.timeZone).toBe("Europe/Amsterdam");
    expect(result.serverTime).toBe(now.toISOString());
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.roles.sort()).toEqual(["mc", "remote-questions"]);
    expect(result.suggestions[0]!.suggestedRoomId).toBe(roomB);
    expect(result.suggestions[0]!.status).toBe("current");
    expect(JSON.stringify(result)).not.toContain(otherId);
  });
  it("does not infer a room for a global duty covering multiple rooms", async () => {
    (snapshot.shifts as Array<Record<string, unknown>>)[0]!.roomId = null;
    await publish();
    expect((await scannerSuggestions(env.DB, eventId, operatorId, now)).suggestions[0]!.suggestedRoomId).toBeNull();
  });
  it("labels a future duty as upcoming even when its overlapping session has started", async () => {
    (snapshot.shifts as Array<Record<string, unknown>>)[0]!.startAt = "2026-10-04T10:15:00.000Z";
    await publish();
    const result = await scannerSuggestions(env.DB, eventId, operatorId, now);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.status).toBe("upcoming");
  });
  it("excludes ended sessions and sessions beyond the server-owned upcoming window", async () => {
    snapshot.occurrences = [
      { id: sessionId, title: "Ended", startAt: "2026-10-04T09:00:00.000Z", endAt: now.toISOString(), roomId: roomA },
      {
        id: crypto.randomUUID(),
        title: "Too late",
        startAt: "2026-10-04T11:00:00.001Z",
        endAt: "2026-10-04T12:00:00.000Z",
        roomId: roomA,
      },
    ];
    await publish();
    expect((await scannerSuggestions(env.DB, eventId, operatorId, now)).suggestions).toEqual([]);
  });
  it("bounds simultaneous suggestions and explicitly reports ambiguity through truncation", async () => {
    const source = (snapshot.occurrences as Array<Record<string, unknown>>)[0]!;
    snapshot.occurrences = Array.from({ length: 25 }, (_, index) => ({
      ...source,
      id: crypto.randomUUID(),
      title: `Session ${index}`,
    }));
    await publish();
    const result = await scannerSuggestions(env.DB, eventId, operatorId, now);
    expect(result.suggestions).toHaveLength(20);
    expect(result.truncated).toBe(true);
  });
  it("returns no defaults without an approved publication", async () => {
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?").bind(eventId).run();
    expect(await scannerSuggestions(env.DB, eventId, operatorId, now)).toEqual({
      serverTime: now.toISOString(),
      timeZone: "UTC",
      publishedRevision: null,
      suggestions: [],
      truncated: false,
    });
  });
  it("uses the mounted authenticated scanner route and never grants access from a duty", async () => {
    const path = "/api/v1/events/suggestions-test/scans/suggestions";
    expect((await callApi(env, path)).status).toBe(401);
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
    )
      .bind(crypto.randomUUID(), otherId, eventId, new Date().toISOString())
      .run();
    const ordinary = await createAdminSession(env.DB, otherId, crypto.randomUUID());
    expect((await callApi(env, path, { headers: { authorization: `Bearer ${ordinary}` } })).status).toBe(403);
    const admin = await createAdminSession(env.DB, operatorId, crypto.randomUUID());
    const response = await callApi(env, path, { headers: { authorization: `Bearer ${admin}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("requires an active scanner grant for the exact event for an assigned ordinary user", async () => {
    const path = "/api/v1/events/suggestions-test/scans/suggestions";
    const token = await createAdminSession(env.DB, otherId, crypto.randomUUID());
    const headers = { authorization: `Bearer ${token}` };
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
    )
      .bind(crypto.randomUUID(), otherId, eventId, new Date().toISOString())
      .run();
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:check','event',?,?)",
    )
      .bind(grantId, otherId, eventId, new Date().toISOString())
      .run();
    expect((await callApi(env, path, { headers })).status).toBe(200);
    const otherEventId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'other-suggestions-test','Other event','UTC','invite_or_open','{}',?,?)",
    )
      .bind(otherEventId, now.toISOString(), now.toISOString())
      .run();
    await env.DB.prepare("UPDATE permission_grants SET context_id=? WHERE id=?").bind(otherEventId, grantId).run();
    expect((await callApi(env, path, { headers })).status).toBe(403);
    await env.DB.prepare("UPDATE permission_grants SET context_id=?,expires_at=? WHERE id=?")
      .bind(eventId, "2020-01-01T00:00:00.000Z", grantId)
      .run();
    expect((await callApi(env, path, { headers })).status).toBe(403);
    await env.DB.prepare("UPDATE permission_grants SET expires_at=NULL,revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), grantId)
      .run();
    expect((await callApi(env, path, { headers })).status).toBe(403);
  });
});
