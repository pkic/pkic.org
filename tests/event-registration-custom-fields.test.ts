import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

async function callAdmin(path: string, token: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("event registration list generic form contract", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns configured interests/topics as custom answers without dietary-specific fields", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    const token = await createAdminSession(env.DB, admin.id, "admin-registration-generic-form-token");
    const formId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms
           (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, 'event', ?, 'event_registration', 'active', 'Interests and topics form', NULL, datetime('now'), datetime('now'))`,
      ).bind(formId, `generic-form-${formId}`, eventId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'interests', 'Interests', 'multi_select', 0,
                 '[{"value":"ml","label":"Machine learning"},{"value":"web","label":"Web PKI"}]', NULL, 10, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'topics', 'Topics', 'text', 0, NULL, NULL, 20, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
    ]);

    const answers = [
      { interests: ["ml", "web"], topics: "security" },
      { interests: ["web"], topics: "interoperability" },
      "{malformed-json",
    ];
    const statements = answers.flatMap((customAnswers, index) => {
      const userId = crypto.randomUUID();
      const registrationId = crypto.randomUUID();
      return [
        env.DB.prepare(
          `INSERT INTO users
             (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Attendee', 'user', 1, datetime('now'), datetime('now'))`,
        ).bind(userId, `generic-${index}@example.test`, `generic-${index}@example.test`, `Attendee${index}`),
        env.DB.prepare(
          `INSERT INTO registrations
             (id, event_id, user_id, status, attendance_type, source_type, custom_answers_json,
              manage_link_secret, created_at, updated_at)
           VALUES (?, ?, ?, 'registered', 'virtual', 'self', ?, ?, datetime('now'), datetime('now'))`,
        ).bind(registrationId, eventId, userId, JSON.stringify(customAnswers), `manage-${registrationId}`),
      ];
    });
    await env.DB.batch(statements);

    const response = await callAdmin("/api/v1/events/pqc-2026/registrations?limit=1&offset=0&sort=display_name", token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      registrations: Array<{ custom_answers_json: string | null; dietary_restrictions?: unknown }>;
      page: { limit: number; total: number };
      stats: Record<string, unknown>;
    };

    expect(body.registrations).toHaveLength(1);
    expect(body.page).toMatchObject({ limit: 1, total: 3 });
    expect(body.stats).not.toHaveProperty("dietaryCounts");
    expect(body.registrations[0]).not.toHaveProperty("dietary_restrictions");
    expect(JSON.parse(body.registrations[0]?.custom_answers_json ?? "null")).toEqual({
      interests: ["ml", "web"],
      topics: "security",
    });
  });
});
