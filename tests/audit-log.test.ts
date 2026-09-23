/**
 * The canonical platform audit endpoint validates
 * `?limit=`/`?offset=`/`?q=`/`?entityType=`/`?actorType=`/`?action=`/
 * `?entityId=`/`?sort=` against auditLogListRouteSchema and reads them from
 * `data.query`. This covers every filter the handler supports, plus
 * pagination, to prove the conversion didn't drop or change behavior.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";
import { onlyPersona } from "./personas/catalog";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { auditLogListQuerySchema } from "../assets/shared/schemas/audit-log";
import { buildGlobalAuditLogPageQuery } from "../functions/_lib/services/audit-log-read";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { listFilterOptionsResponseSchema } from "../assets/shared/schemas/list-filter-options";

async function callAppGet(path: string, token: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

interface AuditLogEntry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogListResponse {
  entries: AuditLogEntry[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

async function insertAuditLogRow(row: {
  id?: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  detailsJson?: string | null;
  secondsAgo: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
  )
    .bind(
      row.id ?? crypto.randomUUID(),
      row.actorType,
      row.actorId ?? null,
      row.action,
      row.entityType,
      row.entityId ?? null,
      row.detailsJson ?? null,
      `-${row.secondsAgo} seconds`,
    )
    .run();
}

async function getAdminUserId(): Promise<string> {
  const rows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1");
  return rows[0].id;
}

describe("GET /api/v1/audit-log", () => {
  let adminToken: string;
  let adminUserId: string;

  it("pages distinct filter choices independently from log rows and validates the field", async () => {
    for (const action of ["form_created", "organization_updated", "user_updated", "form_created"]) {
      await insertAuditLogRow({ actorType: "system", action, entityType: "form", secondsAgo: 1 });
    }
    const first = await callAppGet("/api/v1/audit-log/filters?field=action&limit=2", adminToken);
    expect(first.status).toBe(200);
    const page = listFilterOptionsResponseSchema.parse(await first.json());
    expect(page.options.map((option) => option.value)).toEqual(["form_created", "organization_updated"]);
    expect(page.page).toMatchObject({ total: 3, hasMore: true });
    const last = await callAppGet("/api/v1/audit-log/filters?field=action&limit=2&offset=2", adminToken);
    expect(listFilterOptionsResponseSchema.parse(await last.json()).options.map((option) => option.value)).toEqual([
      "user_updated",
    ]);
    const search = await callAppGet("/api/v1/audit-log/filters?field=action&q=organization", adminToken);
    expect(listFilterOptionsResponseSchema.parse(await search.json()).options).toEqual([
      { value: "organization_updated", label: "organization updated" },
    ]);
    expect((await callAppGet("/api/v1/audit-log/filters?field=details_json", adminToken)).status).toBe(400);
    expect((await callAppGet("/api/v1/audit-log/filters?field=action&limit=201", adminToken)).status).toBe(400);
    expect((await callAppGet("/api/v1/audit-log/filters?field=action", "invalid")).status).toBe(401);
  });

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    adminUserId = await getAdminUserId();
    adminToken = await createAdminSession(env.DB, adminUserId, "admin-audit-log-token");
  });

  it("lists entries with default pagination, newest first", async () => {
    await insertAuditLogRow({ actorType: "system", action: "seed_older", entityType: "event", secondsAgo: 20 });
    await insertAuditLogRow({ actorType: "system", action: "seed_newer", entityType: "event", secondsAgo: 5 });

    const response = await callAppGet("/api/v1/audit-log", adminToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AuditLogListResponse;
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].action).toBe("seed_newer");
    expect(body.entries[1].action).toBe("seed_older");
    expect(body.page).toEqual({ limit: 50, offset: 0, total: 2, hasMore: false });
  });

  it("opens a shareable entry by id with the same audit permission as the list", async () => {
    const id = crypto.randomUUID();
    await insertAuditLogRow({
      id,
      actorType: "admin",
      actorId: adminUserId,
      action: "organization_updated",
      entityType: "organization",
      entityId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ name: { from: "Old", to: "New" } }),
      secondsAgo: 1,
    });

    const response = await callAppGet(`/api/v1/audit-log/${id}`, adminToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      entry: {
        id,
        actor_display: expect.any(String),
        action: "organization_updated",
        details: { name: { to: "New" } },
      },
    });
    expect((await callAppGet(`/api/v1/audit-log/${crypto.randomUUID()}`, adminToken)).status).toBe(404);
    expect((await callAppGet(`/api/v1/audit-log/${id}`, "invalid")).status).toBe(401);
    const outsider = await seedPersona(env.DB, onlyPersona("admin:read"));
    expect((await callAppGet(`/api/v1/audit-log/${id}`, outsider.token!)).status).toBe(403);
  });

  it("filters by entityType", async () => {
    await insertAuditLogRow({ actorType: "system", action: "a1", entityType: "registration", secondsAgo: 10 });
    await insertAuditLogRow({ actorType: "system", action: "a2", entityType: "event", secondsAgo: 5 });

    const response = await callAppGet("/api/v1/audit-log?entityType=registration", adminToken);
    const body = (await response.json()) as AuditLogListResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].entity_type).toBe("registration");
  });

  it("filters by actorType", async () => {
    await insertAuditLogRow({
      actorType: "admin",
      actorId: adminUserId,
      action: "a1",
      entityType: "event",
      secondsAgo: 10,
    });
    await insertAuditLogRow({ actorType: "system", action: "a2", entityType: "event", secondsAgo: 5 });

    const response = await callAppGet("/api/v1/audit-log?actorType=system", adminToken);
    const body = (await response.json()) as AuditLogListResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].actor_type).toBe("system");
  });

  it("resolves member and user actors to display names alongside admin actors", async () => {
    const memberId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'Mira', 'Okafor', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(memberId, `mira-${memberId}@example.test`, `mira-${memberId}@example.test`),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'Solo', NULL, 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(userId, `solo-${userId}@example.test`, `solo-${userId}@example.test`),
    ]);
    await insertAuditLogRow({
      actorType: "admin",
      actorId: adminUserId,
      action: "a1",
      entityType: "event",
      secondsAgo: 30,
    });
    await insertAuditLogRow({
      actorType: "member",
      actorId: memberId,
      action: "a2",
      entityType: "group",
      secondsAgo: 20,
    });
    await insertAuditLogRow({
      actorType: "user",
      actorId: userId,
      action: "a3",
      entityType: "proposal",
      secondsAgo: 10,
    });
    await insertAuditLogRow({ actorType: "system", action: "a4", entityType: "event", secondsAgo: 5 });

    const response = await callAppGet("/api/v1/audit-log?sort=created_at", adminToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as AuditLogListResponse;
    expect(body.entries.map((entry) => [entry.actor_type, entry.actor_display])).toEqual([
      ["admin", "admin@pkic.org"],
      ["member", "Mira Okafor"],
      ["user", "Solo"],
      ["system", null],
    ]);
  });

  it("filters by exact action", async () => {
    await insertAuditLogRow({
      actorType: "system",
      action: "force_status",
      entityType: "registration",
      secondsAgo: 10,
    });
    await insertAuditLogRow({
      actorType: "system",
      action: "force_status_extra",
      entityType: "registration",
      secondsAgo: 5,
    });

    const response = await callAppGet("/api/v1/audit-log?action=force_status", adminToken);
    const body = (await response.json()) as AuditLogListResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].action).toBe("force_status");
  });

  it("filters by exact entityId", async () => {
    const targetId = crypto.randomUUID();
    await insertAuditLogRow({
      actorType: "system",
      action: "a1",
      entityType: "registration",
      entityId: targetId,
      secondsAgo: 10,
    });
    await insertAuditLogRow({
      actorType: "system",
      action: "a2",
      entityType: "registration",
      entityId: crypto.randomUUID(),
      secondsAgo: 5,
    });

    const response = await callAppGet(`/api/v1/audit-log?entityId=${targetId}`, adminToken);
    const body = (await response.json()) as AuditLogListResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].entity_id).toBe(targetId);
  });

  it("free-text q matches action, entity_id, entity_type, and details_json", async () => {
    await insertAuditLogRow({
      actorType: "system",
      action: "unrelated",
      entityType: "event",
      detailsJson: JSON.stringify({ note: "needle-in-details" }),
      secondsAgo: 10,
    });
    await insertAuditLogRow({ actorType: "system", action: "no_match_here", entityType: "user", secondsAgo: 5 });

    const response = await callAppGet("/api/v1/audit-log?q=needle-in-details", adminToken);
    const body = (await response.json()) as AuditLogListResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].details).toEqual({ note: "needle-in-details" });
  });

  it("reads a blank filter as no filter, the same as leaving it out", async () => {
    /*
     * This asserted a 400, on the reasoning that returning unfiltered data
     * for `?q=` silently pretends to have searched. The reasoning was sound
     * and the remedy was worse than the fault: any caller that sent a
     * parameter it had left blank took the whole list down. Issue #11 is what
     * that cost — representatives that never appeared and a members page
     * that listed nothing, because one blank filter refused the request.
     *
     * A blank filter and an absent one are the same request, which is what
     * the frontend's shared collection has always assumed: it drops empty
     * values before building the query. Both ends now agree, and the
     * behaviour is stated rather than inferred — an empty search returns the
     * same rows as no search at all.
     */
    await insertAuditLogRow({ actorType: "system", action: "a1", entityType: "event", secondsAgo: 10 });
    await insertAuditLogRow({ actorType: "system", action: "a2", entityType: "user", secondsAgo: 5 });

    const blank = await callAppGet("/api/v1/audit-log?entityType=&q=&action=", adminToken);
    expect(blank.status).toBe(200);
    const omitted = await callAppGet("/api/v1/audit-log", adminToken);
    expect(omitted.status).toBe(200);

    const blankBody = (await blank.json()) as AuditLogListResponse;
    const omittedBody = (await omitted.json()) as AuditLogListResponse;
    expect(blankBody.entries.map((entry) => entry.action)).toEqual(omittedBody.entries.map((entry) => entry.action));

    // A filter that carries a real value is still applied, and one carrying a
    // value the contract does not offer is still refused.
    const filtered = await callAppGet("/api/v1/audit-log?q=a1", adminToken);
    expect(((await filtered.json()) as AuditLogListResponse).entries).toHaveLength(1);
    expect((await callAppGet("/api/v1/audit-log?limit=0", adminToken)).status).toBe(400);
  });

  it("paginates with limit/offset and reports hasMore, and supports ?sort=", async () => {
    for (let i = 0; i < 5; i++) {
      await insertAuditLogRow({ actorType: "system", action: `bulk_${i}`, entityType: "event", secondsAgo: 5 - i });
    }

    const firstPage = await callAppGet("/api/v1/audit-log?limit=2&offset=0&sort=action", adminToken);
    const firstBody = (await firstPage.json()) as AuditLogListResponse;
    expect(firstBody.entries).toHaveLength(2);
    expect(firstBody.page.total).toBe(5);
    expect(firstBody.page.hasMore).toBe(true);
    expect(firstBody.entries.map((e) => e.action)).toEqual(["bulk_0", "bulk_1"]);

    const lastPage = await callAppGet("/api/v1/audit-log?limit=2&offset=4&sort=action", adminToken);
    const lastBody = (await lastPage.json()) as AuditLogListResponse;
    expect(lastBody.entries).toHaveLength(1);
    expect(lastBody.page.hasMore).toBe(false);
  });

  it("uses the global created-at index for the default D1 page query", async () => {
    const query = buildGlobalAuditLogPageQuery(auditLogListQuerySchema.parse({ limit: 50, offset: 0 }));
    const { pageSql, bindings } = buildOffsetPageSql(query);
    const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
      .bind(...bindings, query.limit, query.offset)
      .all<{ detail: string }>();
    const plan = result.results.map((row) => row.detail).join("\n");

    expect(plan).toContain("idx_audit_log_created_at");
    expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });

  it("rejects an out-of-range limit", async () => {
    const response = await callAppGet("/api/v1/audit-log?limit=500", adminToken);
    expect(response.status).toBe(400);
  });

  it("rejects an unknown sort column", async () => {
    const response = await callAppGet("/api/v1/audit-log?sort=not_a_column", adminToken);
    expect(response.status).toBe(400);
  });

  it("requires admin authentication", async () => {
    const response = await app.fetch(
      new Request("https://app.test/api/v1/audit-log"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(401);
  });

  it("allows a non-admin staff identity with a global audit:read grant", async () => {
    // Exactly the audit permission and nothing else, which is what makes this
    // a statement about the grant rather than about being staff.
    const reader = await seedPersona(env.DB, onlyPersona("audit:read"));
    const staffToken = reader.token!;
    await insertAuditLogRow({ actorType: "system", action: "staff_visible", entityType: "event", secondsAgo: 1 });

    const response = await callAppGet("/api/v1/audit-log", staffToken);
    expect(response.status).toBe(200);
    expect(((await response.json()) as AuditLogListResponse).entries.map((entry) => entry.action)).toContain(
      "staff_visible",
    );
  });

  it("denies a staff identity that has portal capacity but no global audit permission", async () => {
    // Portal capacity without the audit permission: a real staff identity
    // whose authority simply does not extend here.
    const outsider = await seedPersona(env.DB, onlyPersona("admin:read"));
    const staffToken = outsider.token!;
    const response = await callAppGet("/api/v1/audit-log", staffToken);
    expect(response.status).toBe(403);
  });

  it("removes the legacy admin API instead of maintaining a second read path", async () => {
    const response = await callAppGet("/api/v1/admin/audit-log", adminToken);
    expect(response.status).toBe(404);
  });

  it("does not retain the former System API path", async () => {
    const response = await callAppGet("/api/v1/system/audit-log", adminToken);
    expect(response.status).toBe(404);
  });
});
