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

  it("bounds outbox candidate discovery before the read-model page query", async () => {
    const statements = Array.from({ length: 150 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return env.DB.prepare(
        `INSERT INTO email_outbox
           (id, template_key, recipient_email, subject, payload_json, message_type, provider, status,
            attempts, send_after, created_at, updated_at)
         VALUES (?, 'bulk-test', ?, ?, '{}', 'transactional', 'sendgrid', 'queued', 0,
                 datetime('2020-01-01T00:00:00.000Z', '+' || ? || ' seconds'), datetime('now'), datetime('now'))`,
      ).bind(`bulk-due-${suffix}`, `bulk-${suffix}@example.test`, `Bulk ${suffix}`, index);
    });
    for (let index = 0; index < statements.length; index += 100) {
      await env.DB.batch(statements.slice(index, index + 100));
    }

    const response = await call("/api/v1/admin/due-work?bucket=outbox&outboxLimit=2&limit=25&sort=dueAt");
    expect(response.status).toBe(200);
    const payload = adminDueWorkListResponseSchema.parse(await response.json());
    expect(payload.counts.outbox).toBe(2);
    expect(payload.page.total).toBe(2);
    expect(payload.items.map((item) => item.title)).toEqual(["bulk-000@example.test", "bulk-001@example.test"]);
  });

  it("bounds reminder candidates before the global priority window", async () => {
    const event = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug = 'pqc-2026'"))[0];
    const statements = Array.from({ length: 150 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return env.DB.prepare(
        `INSERT INTO invites
           (id, event_id, invitee_email, invitee_first_name, invite_type, link_secret, status,
            reminder_count, last_communication_at, source_type, created_at)
         VALUES (?, ?, ?, ?, 'attendee', ?, 'sent', 0, datetime('now', '-30 days'), 'direct', datetime('now', '-30 days'))`,
      ).bind(
        `bulk-reminder-${suffix}`,
        event.id,
        `reminder-${suffix}@example.test`,
        `Reminder ${suffix}`,
        `bulk-reminder-secret-${suffix}`,
      );
    });
    for (let index = 0; index < statements.length; index += 100) {
      await env.DB.batch(statements.slice(index, index + 100));
    }

    const response = await call("/api/v1/admin/due-work?bucket=reminders&reminderLimit=2&limit=25&sort=dueAt");
    expect(response.status).toBe(200);
    const payload = adminDueWorkListResponseSchema.parse(await response.json());
    expect(payload.counts.reminders).toBe(2);
    expect(payload.page.total).toBe(2);
    expect(payload.items.map((item) => item.title)).toEqual(["Reminder 000", "Reminder 001"]);
  });

  it("shows a pending address only on the registration that owns its email change", async () => {
    const [{ id: firstEventId }] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM events WHERE slug = 'pqc-2026'",
    );
    const secondEventId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const ownerRegistrationId = crypto.randomUUID();
    const otherRegistrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events
           (id, slug, name, timezone, starts_at, registration_mode, invite_limit_attendee,
            settings_json, created_at, updated_at)
         VALUES (?, ?, 'Second Event', 'UTC', '2026-12-05T08:00:00.000Z',
                 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
      ).bind(secondEventId, `due-work-${secondEventId}`),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
         VALUES (?, 'due-primary@example.test', 'due-primary@example.test', 1, datetime('now'), datetime('now'))`,
      ).bind(userId),
      env.DB.prepare(
        `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type,
            confirmation_link_secret, manage_link_secret, pending_confirmation_deadline_at,
            created_at, updated_at)
         VALUES (?, ?, ?, 'pending_email_confirmation', 'virtual', 'open', ?, ?,
                 datetime('now', '+30 days'), datetime('now', '-30 days'), datetime('now', '-30 days'))`,
      ).bind(ownerRegistrationId, firstEventId, userId, crypto.randomUUID(), crypto.randomUUID()),
      env.DB.prepare(
        `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type,
            confirmation_link_secret, manage_link_secret, pending_confirmation_deadline_at,
            created_at, updated_at)
         VALUES (?, ?, ?, 'pending_email_confirmation', 'virtual', 'open', ?, ?,
                 datetime('now', '+30 days'), datetime('now', '-29 days'), datetime('now', '-29 days'))`,
      ).bind(otherRegistrationId, secondEventId, userId, crypto.randomUUID(), crypto.randomUUID()),
    ]);
    await env.DB.prepare(
      `UPDATE users
          SET pending_email = 'due-pending@example.test', pending_email_expires_at = datetime('now', '+1 day'),
              pending_email_change_registration_id = ?
        WHERE id = ?`,
    )
      .bind(ownerRegistrationId, userId)
      .run();

    const response = await call("/api/v1/admin/due-work?bucket=reminders&reminderLimit=10&limit=25&sort=dueAt");
    expect(response.status).toBe(200);
    const payload = adminDueWorkListResponseSchema.parse(await response.json());
    expect(payload.items.map((item) => item.title)).toEqual(
      expect.arrayContaining(["due-pending@example.test", "due-primary@example.test"]),
    );
  });

  it("bounds historical cleanup candidate discovery with an explicit cleanup limit", async () => {
    const statements = Array.from({ length: 150 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      const eventId = `bulk-cleanup-event-${suffix}`;
      return [
        env.DB.prepare(
          `INSERT INTO events
             (id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee,
              settings_json, created_at, updated_at)
           VALUES (?, ?, ?, 'UTC', '2020-01-01', datetime('2020-01-01T00:00:00.000Z', '+' || ? || ' seconds'),
                   'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
        ).bind(eventId, `bulk-cleanup-${suffix}`, `Bulk Cleanup ${suffix}`, index),
        env.DB.prepare(
          "INSERT INTO retention_policies (event_id, user_retention_days, updated_at) VALUES (?, 30, datetime('now'))",
        ).bind(eventId),
      ];
    }).flat();
    for (let index = 0; index < statements.length; index += 100) {
      await env.DB.batch(statements.slice(index, index + 100));
    }

    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT e.id, e.ends_at, rp.user_retention_days
       FROM retention_policies rp
       JOIN events e ON e.id = rp.event_id
       WHERE e.ends_at IS NOT NULL
         AND datetime(e.ends_at) < datetime('now', '-' || rp.user_retention_days || ' days')
       ORDER BY e.ends_at ASC, e.id ASC
       LIMIT 2`,
    ).all<{ detail: string }>();
    expect(plan.results.some((row) => row.detail.includes("idx_events_ends_at_id"))).toBe(true);

    const response = await call(
      "/api/v1/admin/due-work?bucket=cleanup&includeRetention=true&cleanupLimit=2&limit=25&sort=dueAt",
    );
    expect(response.status).toBe(200);
    const payload = adminDueWorkListResponseSchema.parse(await response.json());
    expect(payload.counts.cleanup).toBe(2);
    expect(payload.page.total).toBe(2);
    expect(payload.items.map((item) => item.title)).toEqual(["Bulk Cleanup 000", "Bulk Cleanup 001"]);
  });

  it("rejects an unallowlisted sort instead of interpolating it", async () => {
    expect((await call("/api/v1/admin/due-work?sort=recipient_email")).status).toBe(400);
  });

  it("treats malformed legacy outbox payload JSON as empty instead of failing the list", async () => {
    await env.DB.prepare(
      `INSERT INTO email_outbox
         (id, template_key, recipient_email, subject, payload_json, message_type, provider, status,
          attempts, send_after, created_at, updated_at)
       VALUES
         ('malformed-payload', 'welcome', 'legacy@example.test', 'Legacy', '{broken', 'transactional',
          'sendgrid', 'queued', 0, '2020-01-01T00:00:00.000Z', datetime('now'), datetime('now'))`,
    ).run();

    const response = await call("/api/v1/admin/due-work?bucket=outbox&outboxLimit=10");
    expect(response.status).toBe(200);
    const payload = adminDueWorkListResponseSchema.parse(await response.json());
    expect(payload.items).toEqual([expect.objectContaining({ title: "legacy@example.test" })]);
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
