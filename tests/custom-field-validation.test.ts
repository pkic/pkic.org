import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestPatch as manageRegistration } from "../functions/api/v1/registrations/manage/[token]";

const TEST_DAY = "2026-12-01";

async function seedEventDay(eventId: string): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${eventId}', '${TEST_DAY}', 'Day 1', 100, 10, datetime('now'), datetime('now'))
    `,
  ).run();
}

async function seedRegistrationForm(_db: DatabaseLike, eventId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
      VALUES (
        '${crypto.randomUUID()}',
        'test-registration-form',
        'event',
        '${eventId}',
        'event_registration',
        'active',
        'Registration form',
        NULL,
        datetime('now'),
        datetime('now')
      )
    `),
    env.DB.prepare(`
      INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
      VALUES
        (
          '${crypto.randomUUID()}',
          (SELECT id FROM forms WHERE key = 'test-registration-form'),
          'professional_profile',
          'Professional profile',
          'url',
          1,
          NULL,
          '{"format":"professional_profile","allowedDomains":["linkedin.com","xing.com"]}',
          10,
          datetime('now')
        ),
        (
          '${crypto.randomUUID()}',
          (SELECT id FROM forms WHERE key = 'test-registration-form'),
          'interests',
          'Interests',
          'multi_select',
          0,
          '["PKI","PQC"]',
          '{"allowCustom":false,"maxItems":2}',
          20,
          datetime('now')
        ),
        (
          '${crypto.randomUUID()}',
          (SELECT id FROM forms WHERE key = 'test-registration-form'),
          'availability',
          'Availability',
          'text',
          0,
          NULL,
          '{"format":"date_range"}',
          30,
          datetime('now')
        ),
        (
          '${crypto.randomUUID()}',
          (SELECT id FROM forms WHERE key = 'test-registration-form'),
          'nps',
          'NPS',
          'number',
          0,
          NULL,
          '{"format":"integer","min":0,"max":10}',
          40,
          datetime('now')
        ),
        (
          '${crypto.randomUUID()}',
          (SELECT id FROM forms WHERE key = 'test-registration-form'),
          'dietary_restrictions',
          'Dietary restrictions',
          'multi_select',
          0,
          '["Vegetarian","Vegan","Halal"]',
          '{"allowCustom":false,"showWhen":{"dayAttendanceIn":["in_person"]}}',
          50,
          datetime('now')
        )
    `),
  ]);
}

describe("custom field validation", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("rejects invalid registration custom answers", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await seedRegistrationForm(env.DB, eventId);

    await expect(
      createRegistration(
        createContext(
          env,
          new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              firstName: "Alex",
              lastName: "Tester",
              email: "alex@pkic.org",
              attendanceType: "virtual",
              consents: [
                { termKey: "privacy-policy", version: "v1" },
                { termKey: "code-of-conduct", version: "v1" },
              ],
              customAnswers: {
                professional_profile: "https://facebook.com/alex",
                interests: ["PKI", "Other"],
                availability: { start: "2026-12-01", end: "2026-12-05" },
                nps: 11,
              },
            }),
          }),
          { eventSlug: "pqc-2026" },
        ),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: {
        fieldErrors: {
          professional_profile: expect.any(Array),
          interests: expect.any(Array),
          nps: expect.any(Array),
        },
      },
    });
  });

  it("accepts valid registration custom answers", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await seedEventDay(eventId);
    await seedRegistrationForm(env.DB, eventId);

    const response = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Jamie",
            lastName: "Valid",
            email: "jamie@pkic.org",
            dayAttendance: [{ dayDate: TEST_DAY, attendanceType: "in_person" }],
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
            customAnswers: {
              professional_profile: "https://www.linkedin.com/in/jamie-valid",
              interests: ["PKI", "PQC"],
              availability: { start: "2026-12-01", end: "2026-12-03" },
              nps: 9,
              dietary_restrictions: ["Vegetarian", "Halal"],
            },
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { registrationId: string };
    const row = (
      await queryAll<{ custom_answers_json: string | null }>(
        env.DB,
        "SELECT custom_answers_json FROM registrations WHERE id = ?",
        [payload.registrationId],
      )
    )[0];

    expect(row.custom_answers_json).toBeTruthy();
    const parsed = JSON.parse(String(row.custom_answers_json)) as Record<string, unknown>;
    expect(parsed.professional_profile).toBe("https://www.linkedin.com/in/jamie-valid");
    expect(parsed.interests).toEqual(["PKI", "PQC"]);
    expect(parsed.nps).toBe(9);
    expect(parsed.dietary_restrictions).toEqual(["Vegetarian", "Halal"]);
  });

  it("persists dietary restrictions through self-service manage updates and records useful audit deltas", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await seedEventDay(eventId);
    await seedRegistrationForm(env.DB, eventId);

    const createResponse = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Morgan",
            lastName: "Updater",
            email: "morgan@pkic.org",
            dayAttendance: [{ dayDate: TEST_DAY, attendanceType: "in_person" }],
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
            customAnswers: {
              professional_profile: "https://www.linkedin.com/in/morgan-updater",
              dietary_restrictions: ["Vegetarian"],
            },
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { registrationId: string; manageToken: string };

    const updateResponse = await manageRegistration(
      createContext(
        env,
        new Request(`https://app.test/api/v1/registrations/manage/${created.manageToken}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "update",
            dayAttendance: [{ dayDate: TEST_DAY, attendanceType: "in_person" }],
            customAnswers: {
              professional_profile: "https://www.linkedin.com/in/morgan-updater",
              dietary_restrictions: ["Halal"],
            },
          }),
        }),
        { token: created.manageToken },
      ),
    );

    expect(updateResponse.status).toBe(200);

    const updatedRow = (
      await queryAll<{ custom_answers_json: string | null }>(
        env.DB,
        "SELECT custom_answers_json FROM registrations WHERE id = ?",
        [created.registrationId],
      )
    )[0];
    const updatedAnswers = JSON.parse(String(updatedRow.custom_answers_json)) as Record<string, unknown>;
    expect(updatedAnswers.dietary_restrictions).toEqual(["Halal"]);

    const auditRow = (
      await queryAll<{ details_json: string }>(
        env.DB,
        "SELECT details_json FROM audit_log WHERE action = 'self_service_update' AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
        [created.registrationId],
      )
    )[0];
    const details = JSON.parse(auditRow.details_json) as Record<string, { from: unknown; to: unknown }>;
    expect(details.status).toEqual({ from: "pending_email_confirmation", to: "registered" });
    expect(details.attendanceType).toEqual({ from: "in_person", to: "in_person" });
    expect(details.customAnswers).toEqual({
      from: {
        professional_profile: "https://www.linkedin.com/in/morgan-updater",
        dietary_restrictions: ["Vegetarian"],
      },
      to: {
        professional_profile: "https://www.linkedin.com/in/morgan-updater",
        dietary_restrictions: ["Halal"],
      },
    });
  });
});
