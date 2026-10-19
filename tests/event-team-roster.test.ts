import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { eventTeamRosterResponseSchema } from "../assets/shared/schemas/event-team";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
let eventId: string, token: string, personId: string;
const now = "2026-10-12T12:00:00.000Z";
async function user(name: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,first_name,last_name,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  )
    .bind(id, `${id}@example.test`, `${id}@example.test`, name, "Person", now, now)
    .run();
  return id;
}
async function scoped(permission: string, scope = eventId) {
  const id = await user("Reader");
  await env.DB.prepare(
    "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,'event',?,?)",
  )
    .bind(crypto.randomUUID(), id, permission, scope, now)
    .run();
  return createAdminSession(env.DB, id, crypto.randomUUID());
}
async function roster(auth = token, query = "") {
  return callApi(env, `/api/v1/events/pqc-2026/team${query}`, { headers: { authorization: `Bearer ${auth}` } });
}
beforeEach(async () => {
  await resetDb();
  const seeded = await seedEventAndAdmin(env.DB);
  eventId = seeded.eventId;
  token = await createAdminSession(env.DB, seeded.admin.id, "team-roster-admin");
  personId = await user("Ada");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,created_at) VALUES(?,?,'role-event_moderator','event',?,?)",
    ).bind(crypto.randomUUID(), personId, eventId, now),
    env.DB.prepare(
      "INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,created_at) VALUES(?,?,'role-event_volunteer','event',?,?)",
    ).bind(crypto.randomUUID(), personId, eventId, now),
    env.DB.prepare(
      "INSERT INTO event_agenda_staffing_roles(event_id,id,name,show_on_agenda) VALUES(?,'door','Door',0)",
    ).bind(eventId),
    env.DB.prepare(
      "INSERT INTO event_agenda_role_members(event_id,user_id,roles_json,available_from,available_until,max_minutes,seniority,attendance_mode) VALUES(?,?,?,NULL,NULL,120,'senior','physical')",
    ).bind(eventId, personId, JSON.stringify(["door"])),
  ]);
});
describe("mounted event team roster", () => {
  it("returns one canonical person for multiple access roles and scheduling duties with no emails", async () => {
    const response = await roster(token, "?q=Ada%20Person&limit=1");
    expect(response.status).toBe(200);
    const raw = await response.json();
    const data = eventTeamRosterResponseSchema.parse(raw);
    expect(data.page).toMatchObject({ total: 1, hasMore: false });
    expect(data.people).toHaveLength(1);
    expect(data.people[0]).toMatchObject({
      userId: personId,
      duties: ["Door"],
      staffing: { userId: personId, maxMinutes: 120 },
    });
    expect(data.people[0]!.accessRoles).toHaveLength(2);
    expect(JSON.stringify(raw)).not.toContain("@example.test");
  });
  it("does not disclose access grants to an agenda reader or scheduling fields to an access manager", async () => {
    const agenda = eventTeamRosterResponseSchema.parse(await (await roster(await scoped("agenda:read"))).json());
    expect(agenda.people[0]!.accessRoles).toEqual([]);
    expect(agenda.people[0]!.duties).toEqual(["Door"]);
    const access = eventTeamRosterResponseSchema.parse(await (await roster(await scoped("events:manage"))).json());
    expect(access.people[0]!.accessRoles).toHaveLength(2);
    expect(access.people[0]!.staffing).toBeNull();
    expect(access.people[0]!.duties).toEqual([]);
  });
  it("requires exact event authority and rejects invalid canonical queries", async () => {
    const foreign = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'foreign-team','Foreign','UTC','invite_or_open','{}',?,?)",
    )
      .bind(foreign, now, now)
      .run();
    expect((await roster(await scoped("agenda:read", foreign))).status).toBe(403);
    expect((await callApi(env, "/api/v1/events/pqc-2026/team")).status).toBe(401);
    expect((await roster(token, "?sort=unknown")).status).toBe(400);
  });
  it("returns a valid empty page for a name without matches and bounded exact-person detail", async () => {
    const empty = eventTeamRosterResponseSchema.parse(await (await roster(token, "?q=No%20such%20person")).json());
    expect(empty.people).toEqual([]);
    expect(empty.page.total).toBe(0);
    const exact = eventTeamRosterResponseSchema.parse(await (await roster(token, `?userId=${personId}`)).json());
    expect(exact.people.map((person) => person.userId)).toEqual([personId]);
  });
  it("resolves event read authority again after a grant is revoked", async () => {
    const reader = await scoped("agenda:read");
    expect((await roster(reader)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE permission_grants SET revoked_at=? WHERE permission='agenda:read' AND context_type='event' AND context_id=?",
    )
      .bind(now, eventId)
      .run();
    expect((await roster(reader)).status).toBe(403);
  });
});
