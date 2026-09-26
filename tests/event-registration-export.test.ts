import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import type { Env } from "../functions/_lib/types";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

describe("event registration CSV export", () => {
  let eventId: string;
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    adminToken = await createAdminSession(env.DB, admin.id, "admin-registration-export-token");
  });

  async function seedRegistration(email: string, firstName: string, customAnswers?: unknown): Promise<void> {
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
             (id, event_id, user_id, status, attendance_type, source_type, custom_answers_json,
              manage_link_secret, created_at, updated_at)
           VALUES (?, ?, ?, 'registered', 'in_person', 'self', ?, ?, datetime('now'), datetime('now'))`,
      ).bind(
        registrationId,
        eventId,
        userId,
        customAnswers === undefined ? null : JSON.stringify(customAnswers),
        `manage-${registrationId}`,
      ),
    ]);
  }

  async function exportCsv(overrides: Partial<Env> = {}): Promise<Response> {
    const request = new Request("https://app.test/api/v1/events/pqc-2026/registrations/exports", {
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

  it("adds configured generic fields with option labels and safely formats values", async () => {
    const formId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms
           (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, 'event', ?, 'event_registration', 'active', 'Generic registration form', NULL, datetime('now'), datetime('now'))`,
      ).bind(formId, `generic-export-form-${formId}`, eventId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'interests', 'Interests', 'multi_select', 0,
                 '[{"value":"ml","label":"Machine learning"},{"value":"web","label":"Web PKI"}]', NULL, 10, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'topics', 'Topics', 'select', 0,
                 '[{"value":"interop","label":"Interoperability"}]', NULL, 20, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'attending', 'Attending', 'boolean', 0, NULL, NULL, 30, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'availability', 'Availability', 'text', 0, NULL, NULL, 40, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'metadata', 'Metadata', 'text', 0, NULL, NULL, 50, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
    ]);

    await seedRegistration("generic@example.test", "Generic", {
      interests: ["ml", "web"],
      topics: "interop",
      attending: true,
      availability: { start: "2026-12-01", end: "2026-12-03" },
      metadata: { track: "security" },
    });
    await seedRegistration("scalar@example.test", "Scalar", "scalar-answer");
    await seedRegistration("malformed@example.test", "Malformed", "{malformed-json");
    await env.DB.prepare(
      `UPDATE registrations
       SET custom_answers_json = ?
       WHERE user_id = (SELECT id FROM users WHERE email = ? LIMIT 1)`,
    )
      .bind("{malformed-json", "malformed@example.test")
      .run();

    const response = await exportCsv();
    expect(response.status).toBe(200);
    const csv = await response.text();
    const lines = csv.trim().split("\n");
    const header = lines[0];
    const genericRow = lines.find((line) => line.includes("generic@example.test"));
    const scalarRow = lines.find((line) => line.includes("scalar@example.test"));
    const malformedRow = lines.find((line) => line.includes("malformed@example.test"));
    expect(header).toContain("Interests,Topics,Attending,Availability,Metadata");
    expect(genericRow).toContain("Machine learning, Web PKI");
    expect(genericRow).toContain("Interoperability");
    expect(genericRow).toContain("Yes");
    expect(genericRow).toContain("2026-12-01 – 2026-12-03");
    expect(genericRow).toContain('{""track"":""security""}');
    expect(scalarRow).toMatch(/Scalar/);
    expect(malformedRow).toMatch(/Malformed/);
    expect(scalarRow).not.toContain("scalar-answer");
    expect(malformedRow).not.toContain("malformed-json");
  });
});
