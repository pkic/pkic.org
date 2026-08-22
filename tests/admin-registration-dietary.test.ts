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

describe("admin registration dietary aggregation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("aggregates all registered dietary choices in D1 while returning only the requested page", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    const token = await createAdminSession(env.DB, admin.id, "admin-registration-dietary-token");

    const formId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms
           (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
         VALUES (?, ?, 'event', ?, 'event_registration', 'active', 'Dietary test form', NULL, datetime('now'), datetime('now'))`,
      ).bind(formId, `dietary-form-${formId}`, eventId),
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, 'dietary_restrictions', 'Dietary restrictions', 'multi_select', 0,
                 '["Vegetarian","Vegan","Halal"]', NULL, 10, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId),
    ]);

    const registrationStatements = Array.from({ length: 121 }, (_, index) => {
      const userId = crypto.randomUUID();
      const registrationId = crypto.randomUUID();
      const customAnswers =
        index < 40
          ? { dietary_restrictions: ["Vegetarian", "Halal"] }
          : index < 80
            ? { dietary: ["Vegan"], dietary_restrictions: "Vegan" }
            : index < 120
              ? { dietary_restrictions: ["Vegetarian", "Vegan"], dietary: ["Vegetarian"] }
              : "{malformed-json";

      return [
        env.DB.prepare(
          `INSERT INTO users
             (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Dietary', 'user', 1, datetime('now'), datetime('now'))`,
        ).bind(userId, `dietary-${index}@example.test`, `dietary-${index}@example.test`, `Attendee${index}`),
        env.DB.prepare(
          `INSERT INTO registrations
             (id, event_id, user_id, status, attendance_type, source_type, custom_answers_json,
              manage_link_secret, created_at, updated_at)
           VALUES (?, ?, ?, 'registered', 'virtual', 'self', ?, ?, datetime('now'), datetime('now'))`,
        ).bind(registrationId, eventId, userId, JSON.stringify(customAnswers), `manage-${registrationId}`),
      ];
    }).flat();

    for (let index = 0; index < registrationStatements.length; index += 100) {
      await env.DB.batch(registrationStatements.slice(index, index + 100));
    }

    const response = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?limit=1&offset=0&sort=display_name",
      token,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      registrations: Array<{ dietary_restrictions: string[] | null }>;
      page: { limit: number; total: number };
      stats: { dietaryCounts: Record<string, number> };
    };

    expect(body.registrations).toHaveLength(1);
    expect(body.page).toMatchObject({ limit: 1, total: 121 });
    expect(body.stats.dietaryCounts).toEqual({ Halal: 40, Vegan: 80, Vegetarian: 80 });
    expect(body.registrations[0]?.dietary_restrictions).toEqual(["Vegetarian", "Halal"]);
  });
});
