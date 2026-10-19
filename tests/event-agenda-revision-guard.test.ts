import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaRoomCreateSchema } from "../assets/shared/schemas/event-agenda";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

async function fixture(revision = 0) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const roomId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Original location',NULL)")
    .bind(roomId, eventId)
    .run();
  await env.DB.prepare("INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES(?,?,?)")
    .bind(eventId, revision, nowIso())
    .run();
  const body = agendaRoomCreateSchema.parse({ name: "Renamed location", capacity: null, expectedRevision: 0 });
  const update = (db: DatabaseLike = env.DB) =>
    callApi({ ...env, DB: db } as Env, `/api/v1/events/pqc-2026/agenda/rooms/${roomId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { eventId, admin, roomId, update };
}
async function effects() {
  return {
    rooms: await queryAll(
      env.DB,
      "SELECT id,event_id,name,capacity,setup_minutes,equipment_json,available_periods_json FROM event_agenda_rooms ORDER BY id",
    ),
    state: await queryAll(
      env.DB,
      "SELECT event_id,revision,published_revision,updated_at FROM event_agenda_state ORDER BY event_id",
    ),
    event: await queryAll(env.DB, "SELECT id,settings_json,updated_at FROM events ORDER BY id"),
    audit: await queryAll(env.DB, "SELECT id,action,entity_id,details_json FROM audit_log ORDER BY id"),
    email: await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id"),
    storage: await queryAll(env.DB, "SELECT id FROM storage_deletion_outbox ORDER BY id"),
    push: await queryAll(env.DB, "SELECT id FROM agenda_push_outbox ORDER BY id"),
    revisionGuards: await queryAll(
      env.DB,
      "SELECT id,event_id,expected_revision FROM event_agenda_revision_guards ORDER BY id",
    ),
    authorizationGuards: await queryAll(env.DB, "SELECT id FROM authorization_guards ORDER BY id"),
  };
}
describe("independent agenda revision and permission guards", () => {
  beforeEach(resetDb);
  it("returns the revision conflict through the real permission wrapper for a preexisting stale revision", async () => {
    const f = await fixture(1),
      before = await effects();
    const response = await f.update();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_REVISION_CHANGED" } });
    expect(await effects()).toEqual(before);
  });
  it("rolls back an organizer mutation when another revision commits after the policy read", async () => {
    const f = await fixture();
    let afterCompetitor: Awaited<ReturnType<typeof effects>> | null = null;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO event_agenda_revision_guards"),
      async () => {
        await env.DB.prepare("UPDATE event_agenda_state SET revision=1,updated_at=? WHERE event_id=?")
          .bind(nowIso(), f.eventId)
          .run();
        afterCompetitor = await effects();
      },
    );
    const response = await f.update(db);
    expect(afterCompetitor).not.toBeNull();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_REVISION_CHANGED" } });
    expect(await effects()).toEqual(afterCompetitor);
  });
  it("retains the independent authorization refusal after a grant is revoked before commit", async () => {
    const f = await fixture(),
      before = await effects();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO event_agenda_revision_guards"),
      async () => {
        await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
      },
    );
    const response = await f.update(db);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_AUTHORIZATION_CHANGED" } });
    expect(await effects()).toEqual(before);
  });
  it("commits exactly one valid revision and cleans up both successful guards", async () => {
    const f = await fixture();
    const response = await f.update();
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = await effects();
    expect(saved.rooms).toEqual([expect.objectContaining({ id: f.roomId, name: "Renamed location", capacity: null })]);
    expect(saved.state).toEqual([expect.objectContaining({ event_id: f.eventId, revision: 1 })]);
    expect(saved.audit).toHaveLength(1);
    expect(saved.audit[0]).toMatchObject({ action: "agenda.revision.updated", entity_id: f.eventId });
    expect(JSON.parse(saved.audit[0].details_json as string)).toEqual({
      fromRevision: { from: null, to: 0 },
      toRevision: { from: null, to: 1 },
    });
    expect(saved.revisionGuards).toEqual([]);
    expect(saved.authorizationGuards).toEqual([]);
    expect(saved.email).toEqual([]);
    expect(saved.storage).toEqual([]);
    expect(saved.push).toEqual([]);
  });
});
