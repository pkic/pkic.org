import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { agendaOccurrenceFilterOptionsQuerySchema } from "../assets/shared/schemas/agenda-occurrence-filter-options";
import { listFilterOptionsResponseSchema } from "../assets/shared/schemas/list-filter-options";
import { listAgendaOccurrenceFilterOptions } from "../functions/_lib/services/event-agenda/occurrence-filter-options";
let eventId: string, adminId: string, token: string;
async function speaker(label: string, active = 1) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,preferred_name,first_name,active) VALUES(?,?,?,?,?,?)",
  )
    .bind(id, `${id}@example.test`, `${id}@example.test`, label, "Ignored first name", active)
    .run();
  return id;
}
async function assign(userId: string, event = eventId) {
  const occurrenceId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Assigned session')")
    .bind(occurrenceId, event)
    .run();
  await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
    .bind(occurrenceId, userId)
    .run();
}
async function options(query: Record<string, unknown> = {}) {
  return listAgendaOccurrenceFilterOptions(
    env.DB,
    eventId,
    agendaOccurrenceFilterOptionsQuerySchema.parse({ field: "speakerUserId", ...query }),
  );
}
describe("Canonical bounded agenda speaker filter choices", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    adminId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
    token = await createAdminSession(env.DB, adminId, crypto.randomUUID());
  });
  it("includes direct inactive historical speakers, uses canonical names and deduplicates assignments", async () => {
    const id = await speaker("Historical credit", 0);
    await assign(id);
    await assign(id);
    expect(await options()).toMatchObject({ options: [{ value: id, label: "Historical credit" }], page: { total: 1 } });
  });
  it("pages the full assigned population independently of loaded day or table rows", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 53; index++) {
      const id = await speaker(`Person ${index}`);
      ids.push(id);
      await assign(id);
    }
    const first = await options({ limit: 50, sort: "value" });
    const second = await options({ limit: 50, offset: 50, sort: "value" });
    expect(first.options).toHaveLength(50);
    expect(first.page.total).toBe(53);
    expect(second.options).toHaveLength(3);
    expect([...first.options, ...second.options].map((item) => item.value)).toEqual(ids.sort());
    expect((await options({ limit: 1, sort: "-value" })).options[0].value).toBe(ids.at(-1));
  });
  it("searches only canonical credit labels and excludes unassigned people and foreign event credits", async () => {
    const local = await speaker("Canonical match");
    await assign(local);
    await speaker("Unassigned match");
    const foreign = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,?,'Private','UTC','invite_or_open','{}',?,?)",
    )
      .bind(foreign, foreign, new Date().toISOString(), new Date().toISOString())
      .run();
    const other = await speaker("Foreign match");
    await assign(other, foreign);
    expect((await options({ q: "match" })).options).toEqual([{ value: local, label: "Canonical match" }]);
  });
  it("mounted route requires exact event read authority and returns no-store bounded options", async () => {
    const path = "/api/v1/events/pqc-2026/agenda/occurrences/filters?field=speakerUserId&limit=1";
    expect((await callApi(env, path)).status).toBe(401);
    const id = await speaker("Scoped operator");
    await assign(id);
    const foreignEventId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'foreign-speaker-filter','Foreign event','UTC','invite_or_open','{}',?,?)",
    )
      .bind(foreignEventId, new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
    )
      .bind(crypto.randomUUID(), id, foreignEventId, new Date().toISOString())
      .run();
    const scoped = await createAdminSession(env.DB, id, crypto.randomUUID());
    expect((await callApi(env, path, { headers: { authorization: `Bearer ${scoped}` } })).status).toBe(403);
    const response = await callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(listFilterOptionsResponseSchema.parse(await response.json()).options).toEqual([
      { value: id, label: "Scoped operator" },
    ]);
  });
});
