import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { adminDueWorkListResponseSchema } from "../assets/shared/schemas/admin-due-work";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

describe("admin due-work read model", () => {
  let token: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    token = await createAdminSession(env.DB, admin.id, "admin-due-work-token");
  });

  async function call(path: string): Promise<Response> {
    return app.fetch(
      new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
      env as any,
      { passThroughOnException() {}, waitUntil() {} } as any,
    );
  }

  it("owns bucket filtering, sorting, counts, and pagination on the server", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO email_outbox
           (id, template_key, recipient_email, subject, payload_json, message_type, provider, status,
            attempts, send_after, created_at, updated_at)
         VALUES
           ('due-later', 'welcome', 'later@example.test', 'Later', '{}', 'transactional', 'sendgrid',
            'queued', 0, '2020-01-02T00:00:00.000Z', datetime('now'), datetime('now'))`,
      ),
      env.DB.prepare(
        `INSERT INTO email_outbox
           (id, template_key, recipient_email, subject, payload_json, message_type, provider, status,
            attempts, send_after, created_at, updated_at)
         VALUES
           ('due-first', 'welcome', 'first@example.test', 'First', '{}', 'transactional', 'sendgrid',
            'retrying', 1, '2020-01-01T00:00:00.000Z', datetime('now'), datetime('now'))`,
      ),
    ]);

    const firstPageResponse = await call(
      "/api/v1/admin/due-work?bucket=outbox&reminderLimit=1&outboxLimit=10&limit=1&offset=0&sort=dueAt",
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage = adminDueWorkListResponseSchema.parse(await firstPageResponse.json());
    expect(firstPage.items.map((item) => item.title)).toEqual(["first@example.test"]);
    expect(firstPage.counts.outbox).toBe(2);
    expect(firstPage.page).toMatchObject({ total: 2, hasMore: true });

    const secondPage = adminDueWorkListResponseSchema.parse(
      await (
        await call("/api/v1/admin/due-work?bucket=outbox&reminderLimit=1&outboxLimit=10&limit=1&offset=1&sort=dueAt")
      ).json(),
    );
    expect(secondPage.items.map((item) => item.title)).toEqual(["later@example.test"]);
    expect(secondPage.page.hasMore).toBe(false);
  });

  it("rejects an unallowlisted sort instead of interpolating it", async () => {
    expect((await call("/api/v1/admin/due-work?sort=recipient_email")).status).toBe(400);
  });

  it("fails closed for authenticated staff without admin:read", async () => {
    const staffId = crypto.randomUUID();
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'staff@example.test', 'staff@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(staffId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), staffId, admin.id),
    ]);
    token = await createAdminSession(env.DB, staffId, "staff-due-work-token");

    expect((await call("/api/v1/admin/due-work")).status).toBe(403);

    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'admin:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, admin.id)
      .run();
    expect((await call("/api/v1/admin/due-work")).status).toBe(200);
  });
});
