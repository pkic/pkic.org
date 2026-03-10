import { describe, it, expect } from "vitest";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestPost as confirmEmail } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequestPost as createInvites } from "../functions/api/v1/events/[eventSlug]/invites";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { sha256Hex } from "../functions/_lib/utils/crypto";

function extractConfirmationToken(payloadJson: string): string {
  const payload = JSON.parse(payloadJson) as { confirmationUrl: string };
  const url = new URL(payload.confirmationUrl);
  return url.searchParams.get("token") as string;
}

describe("registration workflows", () => {
  it("enforces consent and supports double opt-in", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    await expect(
      createRegistration(
        createContext(
          env,
          new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                firstName: "Alice",
                lastName: "Doe",
                email: "alice@company.test",
                attendanceType: "virtual",
                sourceType: "direct",
              consents: [{ termKey: "privacy-policy", version: "v1" }],
            }),
          }),
          { eventSlug: "pqc-2026" },
        ),
      ),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });

    const createResponse = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Alice",
            lastName: "Doe",
            email: "alice@company.test",
            attendanceType: "virtual",
            sourceType: "direct",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(createResponse.status).toBe(200);
    const createdPayload = await createResponse.json() as { status: string };
    expect(createdPayload.status).toBe("pending_email_confirmation");

    const outbox = db.raw<{ payload_json: string }>(
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
    );
    const token = extractConfirmationToken(outbox[0].payload_json);

    const confirmResponse = await confirmEmail(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/confirm-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(confirmResponse.status).toBe(200);
    const confirmedPayload = await confirmResponse.json() as { status: string };
    expect(confirmedPayload.status).toBe("registered");
  });

  it("enforces attendee invite abuse limits per attendee", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const manageToken = "manage-token-123";
    const manageHash = await sha256Hex(manageToken);

    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
      VALUES ('${userId}', 'inviter@pkic.org', 'inviter@pkic.org', 'Inviter', NULL, NULL, NULL, NULL, datetime('now'), datetime('now'));

      INSERT INTO registrations (
        id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
        custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
        manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
      ) VALUES (
        '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'virtual',
        'direct', NULL, NULL, NULL, NULL, NULL, '${manageHash}', datetime('now'), NULL, datetime('now'), datetime('now')
      );
    `);

    const invites = Array.from({ length: 6 }).map((_, index) => ({
      email: `target${index}@example.test`,
      firstName: "Target",
      lastName: `${index}`,
    }));

    const response = await createInvites(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/invites", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${manageToken}`,
          },
          body: JSON.stringify({ invites }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(429);
  });
});
