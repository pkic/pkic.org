import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { eventBadgePrintPopulationResponseSchema } from "../assets/shared/schemas/event-badge-printing";
import { createGroup } from "../functions/_lib/services/groups";
import type { DatabaseLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const group = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: "Print population",
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  await env.DB.prepare("UPDATE events SET owner_group_id=? WHERE id=?").bind(group.id, eventId).run();
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const endpoint = `/api/v1/groups/${group.id}/events/${eventId}/registrations/badges/population`;
  const request = (query = "", db: DatabaseLike = env.DB, auth = token) =>
    callApi({ ...env, DB: db }, endpoint + query, {
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });
  const page = async (query = "") => {
    const response = await request(query);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    return eventBadgePrintPopulationResponseSchema.parse(await response.json());
  };
  return { eventId, admin, group, endpoint, request, page };
}
async function registration(eventId: string, label: string, status = "registered", active = 1) {
  const userId = await insertUser(env.DB, `${label}@example.test`);
  await env.DB.prepare("UPDATE users SET first_name=?,last_name='Attendee',active=? WHERE id=?")
    .bind(label, active, userId)
    .run();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,?,'in_person','test',?,datetime('now'),datetime('now'))",
  )
    .bind(id, eventId, userId, status, crypto.randomUUID())
    .run();
  return { id, userId };
}

describe("group-owned badge print population", () => {
  it("enumerates exact eligible IDs with bounded keyset pages and minimal metadata", async () => {
    const f = await fixture();
    const people = await Promise.all([
      registration(f.eventId, "Ada"),
      registration(f.eventId, "Grace"),
      registration(f.eventId, "Linus"),
    ]);
    await registration(f.eventId, "Cancelled", "cancelled");
    await registration(f.eventId, "Pending", "pending_email_confirmation");
    await registration(f.eventId, "Inactive", "registered", 0);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await f.page(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(response.page.total).toBe(3);
      expect(response.registrations.length).toBeLessThanOrEqual(2);
      for (const row of response.registrations)
        expect(Object.keys(row).sort()).toEqual(["display_name", "id", "status", "user_id"]);
      seen.push(...response.registrations.map((row) => row.id));
      cursor = response.page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(people.map((p) => p.id).sort());
    expect(new Set(seen).size).toBe(3);
    const empty = await f.page("?q=Nobody");
    expect(empty).toMatchObject({ registrations: [], page: { total: 0, nextCursor: null } });
  });
  it("reuses registration search/status/active-day waitlist predicates and reports only eligible totals", async () => {
    const f = await fixture();
    const waiting = await registration(f.eventId, "Ada");
    await registration(f.eventId, "Grace");
    const pending = await registration(f.eventId, "Ada-pending", "pending_email_confirmation");
    const dayId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,sort_order,created_at,updated_at) VALUES(?,?,'2026-12-01',0,datetime('now'),datetime('now'))",
    )
      .bind(dayId, f.eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_day_waitlist_entries(id,event_id,registration_id,event_day_id,user_id,priority_lane,position,status,created_at,updated_at) VALUES(?,?,?,?,?,'general',1,'waiting',datetime('now'),datetime('now'))",
    )
      .bind(crypto.randomUUID(), f.eventId, waiting.id, dayId, waiting.userId)
      .run();
    expect((await f.page("?q=ada&waitlisted=true")).registrations.map((r) => r.id)).toEqual([waiting.id]);
    expect((await f.page("?waitlisted=false&status=registered")).registrations.map((r) => r.display_name)).toEqual([
      "Grace Attendee",
    ]);
    expect((await f.page("?status=pending_email_confirmation")).page.total).toBe(0);
    expect((await f.page("?q=ada%40example.test")).registrations[0]?.id).toBe(waiting.id);
    expect(pending.id).not.toBe(waiting.id);
  });
  it("scopes a print run by attendance type and by the role band the badge prints", async () => {
    const f = await fixture();
    const ada = await registration(f.eventId, "Ada");
    const grace = await registration(f.eventId, "Grace");
    const linus = await registration(f.eventId, "Linus");
    const sam = await registration(f.eventId, "Sam");
    await env.DB.prepare("UPDATE registrations SET attendance_type='virtual' WHERE id=?").bind(grace.id).run();
    for (const [id, role] of [
      [grace.id, "moderator"],
      [linus.id, "organizer"],
      [sam.id, "sponsor"],
    ])
      await env.DB.prepare(
        "INSERT INTO registration_badge_role_overrides(registration_id,role,set_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
        .bind(id, role, f.admin.id, new Date().toISOString(), new Date().toISOString())
        .run();
    const ids = async (query: string) => (await f.page(query)).registrations.map((row) => row.id).sort();
    expect(await ids("?attendance_type=in_person")).toEqual([ada.id, linus.id, sam.id].sort());
    expect(await ids("?attendance_type=virtual")).toEqual([grace.id]);
    expect(await ids("?badge_role=attendee")).toEqual([ada.id]);
    expect(await ids("?badge_role=speaker")).toEqual([grace.id]);
    expect(await ids("?badge_role=staff")).toEqual([linus.id]);
    expect(await ids("?badge_role=sponsor&attendance_type=in_person")).toEqual([sam.id]);
    expect(await ids("?badge_role=speaker&attendance_type=in_person")).toEqual([]);
    expect((await f.request("?badge_role=organizer")).status).toBe(400);
  });
  it("reaches matching registrations beyond the shared offset ceiling with a bounded page", async () => {
    const f = await fixture();
    await env.DB.batch([
      env.DB.prepare(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10005) INSERT INTO users(id,email,normalized_email,active,first_name) SELECT printf('%032x',i),printf('bulk-%d@example.test',i),printf('bulk-%d@example.test',i),1,'Bulk' FROM n",
      ),
      env.DB.prepare(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10005) INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) SELECT printf('%032x',i),?,printf('%032x',i),'registered','in_person','test',printf('secret-%d',i),datetime('now'),datetime('now') FROM n",
      ).bind(f.eventId),
    ]);
    const afterTenThousand = (10000).toString(16).padStart(32, "0");
    const tail = await f.page(`?limit=3&cursor=${afterTenThousand}`);
    expect(tail.page).toMatchObject({ total: 10005, nextCursor: (10003).toString(16).padStart(32, "0") });
    expect(tail.registrations.map((r) => r.id)).toEqual(
      [10001, 10002, 10003].map((n) => n.toString(16).padStart(32, "0")),
    );
    const last = await f.page(`?limit=3&cursor=${tail.page.nextCursor}`);
    expect(last.registrations).toHaveLength(2);
    expect(last.page.nextCursor).toBeNull();
  });
  it.each(["?limit=201", "?cursor=not-an-id", "?offset=10001", "?status=unknown"])(
    "refuses invalid population queries %s",
    async (query) => {
      const f = await fixture();
      expect((await f.request(query)).status).toBe(400);
    },
  );
  it("refuses anonymous and unprivileged reads and rechecks live management access before returning rows", async () => {
    const f = await fixture();
    await registration(f.eventId, "Private");
    expect((await f.request("", env.DB, "")).status).toBe(401);
    const outsider = await insertIndividualMember(env.DB, "H6", "outsider@example.test");
    const token = await createMemberSession(env.DB, outsider.userId, crypto.randomUUID());
    expect((await f.request("", env.DB, token)).status).toBe(403);
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("SELECT r.id, r.user_id"),
      () => env.DB.prepare("UPDATE user_roles SET revoked_at=datetime('now') WHERE user_id=?").bind(f.admin.id).run(),
    );
    const refusal = await f.request("", raced);
    expect(refusal.status).toBe(409);
    expect(await refusal.text()).not.toContain("Private Attendee");
  });
  it("reports live population drift rather than claiming a frozen cross-page snapshot", async () => {
    const f = await fixture();
    const rows = await Promise.all([registration(f.eventId, "One"), registration(f.eventId, "Two")]);
    const first = await f.page("?limit=1");
    expect(first.page.total).toBe(2);
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE id=?")
      .bind(rows.find((r) => r.id !== first.registrations[0]?.id)!.id)
      .run();
    const tail = await f.page(`?limit=1&cursor=${first.page.nextCursor}`);
    expect(tail.page.total).toBe(1);
    expect(tail.registrations).toEqual([]);
  });
});
