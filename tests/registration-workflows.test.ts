import { describe, it, expect, beforeEach} from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestPost as confirmEmail } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequestPost as createInvites } from "../functions/api/v1/events/[eventSlug]/invites";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration as createRegistrationService, confirmRegistrationByToken } from "../functions/_lib/services/registrations";

function extractConfirmationToken(payloadJson: string): string {
  const payload = JSON.parse(payloadJson) as { confirmationUrl: string };
  const url = new URL(payload.confirmationUrl);
  return url.searchParams.get("token") as string;
}

describe("registration workflows", () => {
  beforeEach(async () => { await resetDb(); });
  it("enforces consent and supports double opt-in", async () => {
    await seedEventAndAdmin(env.DB);

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

    const outbox = await queryAll<{ payload_json: string }>(env.DB, 
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
    const { eventId } = await seedEventAndAdmin(env.DB);

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const manageToken = "manage-token-123";
    const manageHash = await sha256Hex(manageToken);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${userId}', 'inviter@pkic.org', 'inviter@pkic.org', 'Inviter', NULL, NULL, NULL, NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
          custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
          manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'virtual',
          'direct', NULL, NULL, NULL, NULL, NULL, '${manageHash}', datetime('now'), NULL, datetime('now'), datetime('now')
        )
      `),
    ]);

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

  it("returns day confirmation details when only some selected days are confirmed", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-1', 'day-one@example.test', 'day-one@example.test', 'Day', 'One', datetime('now'), datetime('now')),
          ('user-2', 'day-two@example.test', 'day-two@example.test', 'Day', 'Two', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const first = await createRegistrationService(env.DB, {
      event,
      userId: "user-1",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const second = await createRegistrationService(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });

    const confirmResponse = await confirmEmail(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/confirm-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: second.confirmationToken }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(confirmResponse.status).toBe(200);
    const payload = await confirmResponse.json() as {
      status: string;
      dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
      dayWaitlist: Array<{
        dayDate: string;
        status: string;
        priorityLane: string;
        offerExpiresAt: string | null;
      }>;
      manageUrl: string;
    };

    expect(payload.status).toBe("registered");
    expect(payload.dayAttendance).toEqual([
      { dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" },
    ]);
    expect(payload.dayWaitlist).toEqual([
      {
        dayDate: "2026-12-01",
        status: "waiting",
        priorityLane: "general",
        offerExpiresAt: null,
      },
    ]);
    expect(payload.manageUrl).toContain("/register/manage/");
  });
});
