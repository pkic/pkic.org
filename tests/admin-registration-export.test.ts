import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import type { Env } from "../functions/_lib/types";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

describe("admin registration CSV export", () => {
  let eventId: string;
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    adminToken = await createAdminSession(env.DB, admin.id, "admin-registration-export-token");
  });

  async function seedRegistration(email: string, firstName: string): Promise<void> {
    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
             (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Attendee', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(userId, email, email, firstName),
      env.DB.prepare(
        `INSERT INTO registrations
             (id, event_id, user_id, status, attendance_type, source_type,
              manage_link_secret, created_at, updated_at)
           VALUES (?, ?, ?, 'registered', 'in_person', 'self', ?, datetime('now'), datetime('now'))`,
      ).bind(registrationId, eventId, userId, `manage-${registrationId}`),
    ]);
  }

  async function exportCsv(overrides: Partial<Env> = {}): Promise<Response> {
    const request = new Request("https://app.test/api/v1/admin/events/pqc-2026/registrations/export", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    return app.fetch(request, { ...(env as unknown as Env), ...overrides }, {
      passThroughOnException() {},
      waitUntil() {},
    } as unknown as ExecutionContext);
  }

  it("neutralizes formulas and audits a successful export", async () => {
    await seedRegistration("formula@example.test", "=2+2");

    const response = await exportCsv();
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("'=2+2 Attendee");
    const [audit] = await queryAll<{ action: string; details_json: string }>(
      env.DB,
      "SELECT action, details_json FROM audit_log WHERE action = 'admin_registration_export'",
    );
    expect(audit.action).toBe("admin_registration_export");
    expect(JSON.parse(audit.details_json)).toMatchObject({ recordCount: { from: null, to: 1 } });
  });

  it("rejects an export over the configured row limit without auditing a download", async () => {
    await seedRegistration("one@example.test", "One");
    await seedRegistration("two@example.test", "Two");

    const response = await exportCsv({ CSV_EXPORT_MAX_ROWS: "1" });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CSV_EXPORT_ROW_LIMIT_EXCEEDED" } });
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'admin_registration_export'"),
    ).resolves.toHaveLength(0);
  });
});
