import { describe, expect, it } from "vitest";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";

async function seedRegistrationForm(db: D1DatabaseShim, eventId: string): Promise<void> {
  await db.exec?.(`
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
    );

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
      );
  `);
}

describe("custom field validation", () => {
  it("rejects invalid registration custom answers", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    await seedRegistrationForm(db, eventId);

    const env = createEnv(db);

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
              email: "alex@example.test",
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
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    await seedRegistrationForm(db, eventId);

    const env = createEnv(db);

    const response = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Jamie",
            lastName: "Valid",
            email: "jamie@example.test",
            attendanceType: "virtual",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
            customAnswers: {
              professional_profile: "https://www.linkedin.com/in/jamie-valid",
              interests: ["PKI", "PQC"],
              availability: { start: "2026-12-01", end: "2026-12-03" },
              nps: 9,
            },
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { registrationId: string };
    const row = db.raw<{ custom_answers_json: string | null }>(
      "SELECT custom_answers_json FROM registrations WHERE id = ?",
      [payload.registrationId],
    )[0];

    expect(row.custom_answers_json).toBeTruthy();
    const parsed = JSON.parse(String(row.custom_answers_json)) as Record<string, unknown>;
    expect(parsed.professional_profile).toBe("https://www.linkedin.com/in/jamie-valid");
    expect(parsed.interests).toEqual(["PKI", "PQC"]);
    expect(parsed.nps).toBe(9);
  });
});
