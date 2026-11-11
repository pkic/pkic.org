import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createGroup } from "../functions/_lib/services/groups";
import { eventAttendanceRegistrationsListResponseSchema } from "../assets/shared/schemas/event-registrations";
import { eventBadgePrintPopulationResponseSchema } from "../assets/shared/schemas/event-badge-printing";

beforeEach(resetDb);
async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const group = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: "Roster filters",
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  await env.DB.prepare("UPDATE events SET owner_group_id=? WHERE id=?").bind(group.id, eventId).run();
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const root = `/api/v1/groups/${group.id}/events/${eventId}/registrations`;
  const days = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [index, id] of days.entries())
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,sort_order,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))",
    )
      .bind(id, eventId, `2030-04-${12 + index}`, index)
      .run();
  async function attendee(name: string, types: Array<string | null>, status = "registered") {
    const user = await insertUser(env.DB, `${name.toLowerCase()}@example.test`);
    await env.DB.prepare("UPDATE users SET first_name=?,last_name='Example' WHERE id=?").bind(name, user).run();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,?,'test',?,datetime('now'),datetime('now'))",
    )
      .bind(id, eventId, user, status, crypto.randomUUID())
      .run();
    for (const [index, type] of types.entries())
      if (type)
        await env.DB.prepare(
          "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) VALUES(?,?,?,?,datetime('now'),datetime('now'))",
        )
          .bind(crypto.randomUUID(), id, days[index], type)
          .run();
    return id;
  }
  const matching = await attendee("Matching", ["in_person", "virtual"]);
  const both = await attendee("Both", ["in_person", "in_person"]);
  const unrelated = await attendee("Unrelated", [null, "in_person"]);
  const cancelled = await attendee("Cancelled", ["in_person", "in_person"], "cancelled");
  const get = (suffix: string, authorized = true) =>
    callApi(env, root + suffix, { headers: authorized ? { authorization: `Bearer ${token}` } : {} });
  return { get, matching, both, unrelated, cancelled, eventId, days };
}
it("keeps table, selected CSV and badge populations inside the same day filters through mounted routes", async () => {
  const f = await fixture();
  const query = "?day_dates=2030-04-12&attendance_type=in_person&waitlisted=false";
  const listed = await f.get(query);
  expect(listed.status, await listed.clone().text()).toBe(200);
  const table = eventAttendanceRegistrationsListResponseSchema.parse(await listed.json());
  expect(table.registrations.map((row) => row.id).sort()).toEqual([f.matching, f.both, f.cancelled].sort());
  const printed = await f.get(`/badges/population${query}`);
  expect(printed.status, await printed.clone().text()).toBe(200);
  expect(
    eventBadgePrintPopulationResponseSchema
      .parse(await printed.json())
      .registrations.map((row) => row.id)
      .sort(),
  ).toEqual([f.matching, f.both, f.cancelled].sort());
  const allCsv = await f.get(`/exports${query}`);
  expect(allCsv.status).toBe(200);
  const allText = await allCsv.text();
  expect(allText).toContain("Cancelled Example");
  expect(allText).not.toContain("Unrelated Example");
  const selected = await f.get(`/exports${query}&ids=${f.both},${f.unrelated}`);
  expect(selected.status).toBe(200);
  const text = await selected.text();
  expect(text).toContain("Both Example");
  expect(text).not.toContain("Matching Example");
  expect(text).not.toContain("Unrelated Example");
  const everyDay = await f.get(
    "?day_dates=2030-04-12,2030-04-13&day_match=all&attendance_type=in_person&status=registered",
  );
  expect(
    eventAttendanceRegistrationsListResponseSchema.parse(await everyDay.json()).registrations.map((row) => row.id),
  ).toEqual([f.both]);
});
it("matches any or every selected attendance type, within the selected days", async () => {
  const f = await fixture();
  const ids = async (query: string) => {
    const response = await f.get(`${query}&status=registered`);
    expect(response.status, await response.clone().text()).toBe(200);
    return eventAttendanceRegistrationsListResponseSchema
      .parse(await response.json())
      .registrations.map((row) => row.id)
      .sort();
  };
  expect(await ids("?attendance_type=virtual,in_person")).toEqual([f.matching, f.both, f.unrelated].sort());
  expect(await ids("?attendance_type=in_person,virtual&attendance_match=all")).toEqual([f.matching]);
  expect(await ids("?day_dates=2030-04-13&attendance_type=in_person,virtual&attendance_match=all")).toEqual([]);
  const printed = await f.get("/badges/population?attendance_type=in_person,virtual&attendance_match=all");
  expect(printed.status, await printed.clone().text()).toBe(200);
  expect(
    eventBadgePrintPopulationResponseSchema.parse(await printed.json()).registrations.map((row) => row.id),
  ).toEqual([f.matching]);
  expect((await f.get("?attendance_type=in_person,in_person")).status).toBe(400);
});
it("matches any selected status, so an attendance type can leave cancelled registrations out", async () => {
  const f = await fixture();
  const ids = async (query: string) => {
    const response = await f.get(query);
    expect(response.status, await response.clone().text()).toBe(200);
    return eventAttendanceRegistrationsListResponseSchema
      .parse(await response.json())
      .registrations.map((row) => row.id)
      .sort();
  };
  expect(await ids("?attendance_type=in_person")).toEqual([f.matching, f.both, f.unrelated, f.cancelled].sort());
  expect(await ids("?attendance_type=in_person&status=registered,pending_email_confirmation")).toEqual(
    [f.matching, f.both, f.unrelated].sort(),
  );
  const printed = await f.get("/badges/population?attendance_type=in_person&status=cancelled,registered");
  expect(printed.status, await printed.clone().text()).toBe(200);
  expect(
    eventBadgePrintPopulationResponseSchema
      .parse(await printed.json())
      .registrations.map((row) => row.id)
      .sort(),
  ).toEqual([f.matching, f.both, f.unrelated, f.cancelled].sort());
  // The in-person card: the same people, its cancellations counted apart.
  const stats = eventAttendanceRegistrationsListResponseSchema.parse(await (await f.get("")).json()).stats;
  expect(stats.attendanceStatusByType.in_person).toMatchObject({ total: 3, pending: 0, cancelled: 1 });
  expect(stats.attendanceStatusByType.virtual).toMatchObject({ total: 1, cancelled: 0 });
  expect((await f.get("?status=registered,registered")).status).toBe(400);
  expect((await f.get("?status=registered,unknown")).status).toBe(400);
});
it("keeps negative type waitlist filters consistent across roster, CSV and print population", async () => {
  const f = await fixture();
  await env.DB.prepare(
    "INSERT INTO event_day_waitlist_entries(id,event_id,registration_id,event_day_id,user_id,priority_lane,position,status,created_at,updated_at) SELECT ?,event_id,id,?,user_id,'general',1,'waiting',created_at,updated_at FROM registrations WHERE id=?",
  )
    .bind(crypto.randomUUID(), f.days[1], f.matching)
    .run();
  for (const [type, matches] of [
    ["in_person", true],
    ["virtual", false],
  ] as const) {
    const query = `?attendance_type=${type}&waitlisted=false`;
    const listed = await f.get(query);
    expect(listed.status).toBe(200);
    const rows = eventAttendanceRegistrationsListResponseSchema.parse(await listed.json()).registrations;
    expect(rows.some((row) => row.id === f.matching)).toBe(matches);
    const printed = await f.get(`/badges/population${query}`);
    expect(printed.status).toBe(200);
    const population = eventBadgePrintPopulationResponseSchema.parse(await printed.json()).registrations;
    expect(population.some((row) => row.id === f.matching)).toBe(matches);
    const exported = await f.get(`/exports${query}`);
    expect(exported.status).toBe(200);
    expect((await exported.text()).includes("Matching Example")).toBe(matches);
  }
});
it("refuses malformed day filters and unauthenticated downloads rather than broadening their population", async () => {
  const f = await fixture();
  for (const path of ["", "/exports", "/badges/population"]) {
    const invalid = await f.get(`${path}?day_dates=not-a-date`);
    expect(invalid.status).toBe(400);
    const unauthorized = await f.get(`${path}?day_dates=2030-04-12`, false);
    expect(unauthorized.status).toBe(401);
  }
});
