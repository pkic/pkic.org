/**
 * P6M-FT-01 / P6M-FT-02: both proposal- and registration-scoped audit-log
 * endpoints previously hard-capped at LIMIT 200 with no offset/hasMore,
 * silently truncating past 200 rows instead of paginating. They now accept
 * ?limit=/?offset= and return a real `page` envelope.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import app from "../functions/router";

async function callAppGet(path: string, token: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertAuditLogRows(entityType: string, entityId: string, count: number): Promise<void> {
  const statements = Array.from({ length: count }, (_, i) =>
    env.DB.prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at)
       VALUES (?, 'admin', NULL, 'test_action', ?, ?, NULL, datetime('now', ?))`,
    ).bind(crypto.randomUUID(), entityType, entityId, `-${count - i} seconds`),
  );
  await env.DB.batch(statements);
}

async function getAdminUserId(): Promise<string> {
  const rows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1");
  return rows[0].id;
}

describe("proposal audit-log pagination (P6M-FT-01)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("paginates with limit/offset and reports hasMore", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const adminUserId = await getAdminUserId();
    const proposalId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO session_proposals
         (id, event_id, proposer_user_id, status, proposal_type, title, abstract, manage_link_secret, submitted_at, updated_at)
       VALUES (?, ?, ?, 'submitted', 'talk', 'Test Talk', ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(proposalId, eventId, adminUserId, "A".repeat(80), crypto.randomUUID())
      .run();
    await insertAuditLogRows("proposal", proposalId, 5);

    const staffToken = await createAdminSession(env.DB, adminUserId, "ft01-token");
    const response = await callAppGet(`/api/v1/admin/proposals/${proposalId}/audit-log?limit=2&offset=0`, staffToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { auditLog: unknown[]; page: { total: number; hasMore: boolean } };
    expect(body.auditLog).toHaveLength(2);
    expect(body.page.total).toBe(5);
    expect(body.page.hasMore).toBe(true);

    const lastPage = await callAppGet(`/api/v1/admin/proposals/${proposalId}/audit-log?limit=2&offset=4`, staffToken);
    const lastBody = (await lastPage.json()) as { auditLog: unknown[]; page: { hasMore: boolean } };
    expect(lastBody.auditLog).toHaveLength(1);
    expect(lastBody.page.hasMore).toBe(false);

    const invalid = await callAppGet(`/api/v1/admin/proposals/${proposalId}/audit-log?limit=0`, staffToken);
    expect(invalid.status).toBe(400);
  });
});

describe("registration audit-log pagination (P6M-FT-02)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("paginates with limit/offset and reports hasMore", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const adminUserId = await getAdminUserId();
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, data_json, created_at, updated_at)
       VALUES (?, 'reg-audit@wf.test', 'reg-audit@wf.test', 'Reg', 'Audit', NULL, datetime('now'), datetime('now'))`,
    )
      .bind(userId)
      .run();
    const registrationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'virtual', 'admin', ?, datetime('now'), datetime('now'))`,
    )
      .bind(registrationId, eventId, userId, crypto.randomUUID())
      .run();
    await insertAuditLogRows("registration", registrationId, 5);

    const eventSlugRow = await env.DB.prepare("SELECT slug FROM events WHERE id = ?").bind(eventId).first<{
      slug: string;
    }>();
    const staffToken = await createAdminSession(env.DB, adminUserId, "ft02-token");
    const response = await callAppGet(
      `/api/v1/admin/events/${eventSlugRow!.slug}/registrations/${registrationId}/audit-log?limit=2&offset=0`,
      staffToken,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { auditLog: unknown[]; page: { total: number; hasMore: boolean } };
    expect(body.auditLog).toHaveLength(2);
    expect(body.page.total).toBe(5);
    expect(body.page.hasMore).toBe(true);

    const invalid = await callAppGet(
      `/api/v1/admin/events/${eventSlugRow!.slug}/registrations/${registrationId}/audit-log?offset=-1`,
      staffToken,
    );
    expect(invalid.status).toBe(400);
  });
});
