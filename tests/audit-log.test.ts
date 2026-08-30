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

  it("rejects an empty shared search value instead of silently returning unfiltered data", async () => {
    await insertAuditLogRow({ actorType: "system", action: "a1", entityType: "event", secondsAgo: 10 });
    await insertAuditLogRow({ actorType: "system", action: "a2", entityType: "user", secondsAgo: 5 });

    const response = await callAppGet("/api/v1/audit-log?entityType=&q=&action=", adminToken);
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
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
