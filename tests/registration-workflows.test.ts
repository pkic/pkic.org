import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestPost as confirmEmail } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequestPatch as manageRegistration } from "../functions/api/v1/registrations/manage/[token]";
import { onRequestPost as createInvites } from "../functions/api/v1/events/[eventSlug]/invites";
import { createContext, deliveredEmailPayload, seedEventAndAdmin, queryAll } from "./helpers/context";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createInvite } from "../functions/_lib/services/invites";
import {
  createRegistration as createRegistrationService,
  confirmRegistrationByToken,
  updateRegistrationById,
} from "../functions/_lib/services/registrations";
import { promoteEventWaitlistWithNotifications } from "../functions/_lib/services/registrations/waitlist-promotions";
import { listCampaignRecipients } from "../functions/_lib/services/admin-email-campaign";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";

async function extractConfirmationToken(payloadJson: string): Promise<string> {
  const payload = await deliveredEmailPayload<{ confirmationUrl: string }>(env.DB, env, payloadJson);
  const url = new URL(payload.confirmationUrl);
  return url.searchParams.get("token") as string;
}

describe("registration workflows", () => {
  beforeEach(async () => {
    await resetDb();
  });
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
              email: "alice@pkic.org",
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
            email: "alice@pkic.org",
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
    const createdPayload = (await createResponse.json()) as { status: string };
    expect(createdPayload.status).toBe("pending_email_confirmation");

    const outbox = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
    );
    const token = await extractConfirmationToken(outbox[0].payload_json);

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
    const confirmedPayload = (await confirmResponse.json()) as { status: string };
    expect(confirmedPayload.status).toBe("registered");
  }, 15_000);

  it("rolls back confirmation when the confirmed-email intent cannot be committed", async () => {
    await seedEventAndAdmin(env.DB);
    const createResponse = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Confirm",
            lastName: "Rollback",
            email: "confirm-rollback@pkic.org",
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
    const [confirmationEmail] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = ?",
      "confirm-rollback@pkic.org",
    );
    const token = await extractConfirmationToken(confirmationEmail.payload_json);
    await env.DB.prepare(
      `CREATE TRIGGER reject_registration_confirmed_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'registration_confirmed'
       BEGIN
         SELECT RAISE(ABORT, 'forced confirmed-email failure');
       END`,
    ).run();

    try {
      await expect(
        confirmEmail(
          createContext(
            env,
            new Request("https://app.test/api/v1/events/pqc-2026/registrations/confirm-email", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token }),
            }),
            { eventSlug: "pqc-2026" },
          ),
        ),
      ).rejects.toThrow("forced confirmed-email failure");
      const [stored] = await queryAll<{ status: string; confirmation_link_secret: string | null }>(
        env.DB,
        `SELECT status, confirmation_link_secret FROM registrations
         WHERE user_id = (SELECT id FROM users WHERE normalized_email = ?)`,
        "confirm-rollback@pkic.org",
      );
      expect(stored.status).toBe("pending_email_confirmation");
      expect(stored.confirmation_link_secret).not.toBeNull();
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM audit_log WHERE action = 'registration_email_confirmed' AND entity_id IN (SELECT id FROM registrations WHERE user_id = (SELECT id FROM users WHERE normalized_email = ?))",
          "confirm-rollback@pkic.org",
        ),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_registration_confirmed_email").run();
    }
  });

  it("commits exactly one confirmation aggregate when the same token is used concurrently", async () => {
    await seedEventAndAdmin(env.DB);
    await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Confirm",
            lastName: "Concurrent",
            email: "confirm-concurrent@pkic.org",
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
    const [confirmationEmail] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = ?",
      "confirm-concurrent@pkic.org",
    );
    const token = await extractConfirmationToken(confirmationEmail.payload_json);
    const attempt = () =>
      confirmEmail(
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
    const responses = await Promise.allSettled([attempt(), attempt()]);
    expect(responses.filter((response) => response.status === "fulfilled")).toHaveLength(1);
    expect(responses.filter((response) => response.status === "rejected")).toHaveLength(1);
    const fulfilled = responses.find(
      (response): response is PromiseFulfilledResult<Response> => response.status === "fulfilled",
    );
    const rejected = responses.find((response) => response.status === "rejected");
    expect(fulfilled?.value.status).toBe(200);
    expect(rejected && rejected.status === "rejected" ? rejected.reason : null).toMatchObject({
      status: 404,
      code: "CONFIRM_TOKEN_INVALID",
    });
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM email_outbox WHERE template_key = 'registration_confirmed' AND recipient_email = ?",
          "confirm-concurrent@pkic.org",
        )
      )[0]?.count,
    ).toBe(1);
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          `SELECT COUNT(*) AS count FROM audit_log
           WHERE action = 'registration_email_confirmed'
             AND entity_id IN (SELECT id FROM registrations WHERE user_id = (SELECT id FROM users WHERE normalized_email = ?))`,
          "confirm-concurrent@pkic.org",
        )
      )[0]?.count,
    ).toBe(1);
  });

  it("rolls back the complete registration aggregate when its durable email intent fails", async () => {
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `CREATE TRIGGER reject_registration_confirmation_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'registration_confirm_email'
       BEGIN
         SELECT RAISE(ABORT, 'forced outbox failure');
       END`,
    ).run();

    try {
      await expect(
        createRegistration(
          createContext(
            env,
            new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                firstName: "Atomic",
                lastName: "Rollback",
                email: "atomic-rollback@pkic.org",
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
        ),
      ).rejects.toBeTruthy();

      for (const table of ["users", "registrations", "consent_acceptances", "referral_codes", "engagement_events"]) {
        const rows = await queryAll<{ count: number }>(
          env.DB,
          `SELECT COUNT(*) AS count FROM ${table} WHERE ${table === "users" ? "normalized_email = ?" : table === "registrations" ? "user_id IN (SELECT id FROM users WHERE normalized_email = ?)" : table === "consent_acceptances" || table === "engagement_events" ? "user_id IN (SELECT id FROM users WHERE normalized_email = ?)" : "created_by_user_id IN (SELECT id FROM users WHERE normalized_email = ?)"}`,
          "atomic-rollback@pkic.org",
        );
        expect(rows[0]?.count).toBe(0);
      }
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_registration_confirmation_email").run();
    }
  });

  it("accepts a pending invite when the matching registration is confirmed", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { invite } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "matching-invite@pkic.org",
      inviteeFirstName: "Match",
      inviteType: "attendee",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });

    const createResponse = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Match",
            lastName: "Invite",
            email: "matching-invite@pkic.org",
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

    const outbox = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
    );
    const token = await extractConfirmationToken(outbox[0].payload_json);

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

    const rows = await queryAll<{
      registration_status: string;
      invite_id: string | null;
      invite_status: string | null;
    }>(
      env.DB,
      `SELECT r.status AS registration_status, r.invite_id, i.status AS invite_status
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN invites i ON i.id = r.invite_id
       WHERE r.event_id = ? AND u.normalized_email = ?
       LIMIT 1`,
      [eventId, "matching-invite@pkic.org"],
    );

    expect(rows[0].registration_status).toBe("registered");
    expect(rows[0].invite_id).toBe(invite.id);
    expect(rows[0].invite_status).toBe("accepted");
  });

  it("keeps the invite token as the source of truth when confirmation email matches a different invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const tokenInvite = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "token-user@example.test",
      inviteType: "attendee",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    const emailInvite = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "email-user@example.test",
      inviteType: "attendee",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });

    const createResponse = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Token",
            lastName: "User",
            email: "email-user@example.test",
            inviteToken: tokenInvite.token,
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
    const createdPayload = (await createResponse.json()) as { status: string; registrationId: string };
    expect(createdPayload.status).toBe("registered");

    const rows = await queryAll<{
      registration_invite_id: string | null;
      token_invite_status: string;
      email_invite_status: string;
    }>(
      env.DB,
      `SELECT r.invite_id AS registration_invite_id,
              t.status AS token_invite_status,
              e.status AS email_invite_status
       FROM registrations r
       LEFT JOIN invites t ON t.id = ?
       LEFT JOIN invites e ON e.id = ?
       WHERE r.id = ?
       LIMIT 1`,
      [tokenInvite.invite.id, emailInvite.invite.id, createdPayload.registrationId],
    );

    expect(rows[0].registration_invite_id).toBe(tokenInvite.invite.id);
    expect(rows[0].token_invite_status).toBe("accepted");
    expect(rows[0].email_invite_status).toBe("revoked");
  });

  it("enforces attendee invite abuse limits per attendee", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const manageLinkSecret = await sha256Hex("manage-token-123");

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${userId}', 'inviter@pkic.org', 'inviter@pkic.org', 'Inviter', NULL, NULL, NULL, NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
          custom_answers_json, referred_by_code, confirmation_link_secret,
          manage_link_secret, confirmed_at, cancelled_at, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'virtual',
          'direct', NULL, NULL, NULL, NULL, '${manageLinkSecret}', datetime('now'), NULL, datetime('now'), datetime('now')
        )
      `),
    ]);
    const manageToken = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "registration_manage",
      resourceId: registrationId,
    });

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
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const second = await createRegistrationService(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
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
    const payload = (await confirmResponse.json()) as {
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
    expect(payload.dayAttendance).toEqual([{ dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" }]);
    expect(payload.dayWaitlist).toEqual([
      {
        dayDate: "2026-12-01",
        status: "waiting",
        priorityLane: "general",
        offerExpiresAt: null,
      },
    ]);
    expect(payload.manageUrl).toContain("/register/manage/");

    const outboxRows = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirmed' AND recipient_email = 'day-two@example.test' ORDER BY created_at DESC LIMIT 1",
    );
    const emailPayload = JSON.parse(outboxRows[0].payload_json) as {
      status: string;
      registrationStatus: string;
      isWaitlisted: boolean;
      hasActiveDayWaitlist: boolean;
      waitlistedDayCount: number;
    };
    expect(emailPayload.status).toBe("registered");
    expect(emailPayload.registrationStatus).toBe("registered");
    expect(emailPayload.isWaitlisted).toBe(true);
    expect(emailPayload.hasActiveDayWaitlist).toBe(true);
    expect(emailPayload.waitlistedDayCount).toBe(1);

    const recipients = await listCampaignRecipients(env.DB, event, "https://app.test", {
      audience: "attendees",
      attendeeStatus: "registered",
      dayWaitlistStatus: "active",
    });
    expect(recipients.map((recipient) => recipient.email)).toEqual(["day-two@example.test"]);
    expect(recipients[0].templateData.status).toBe("registered");
    expect(recipients[0].templateData.registrationStatus).toBe("registered");
    expect(recipients[0].templateData.isWaitlisted).toBe(true);
    expect(recipients[0].templateData.dayAttendance).toEqual([
      {
        dayLabel: "Day 1",
        attendanceLabel: "In person",
        statusLabel: "Waitlisted for in-person attendance",
        waitlistStatus: "waiting",
        isWaitlisted: true,
        isWaitlistOffer: false,
      },
    ]);
  });

  it("includes full per-day waitlist details when all selected in-person days are full", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES
          ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now')),
          ('day-2', '${eventId}', '2026-12-02', 'Day 2', 1, 20, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('holder-1', 'holder1@example.test', 'holder1@example.test', 'Holder', 'One', datetime('now'), datetime('now')),
          ('holder-2', 'holder2@example.test', 'holder2@example.test', 'Holder', 'Two', datetime('now'), datetime('now')),
          ('wait-all', 'wait-all@example.test', 'wait-all@example.test', 'Wait', 'All', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const holder1 = await createRegistrationService(env.DB, {
      event,
      userId: "holder-1",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder1.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const holder2 = await createRegistrationService(env.DB, {
      event,
      userId: "holder-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder2.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const waiting = await createRegistrationService(env.DB, {
      event,
      userId: "wait-all",
      attendanceType: "in_person",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const confirmResponse = await confirmEmail(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations/confirm-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: waiting.confirmationToken }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(confirmResponse.status).toBe(200);
    const payload = (await confirmResponse.json()) as {
      status: string;
      dayWaitlist: Array<{ dayDate: string; status: string }>;
    };

    expect(payload.status).toBe("registered");
    expect(payload.dayWaitlist).toHaveLength(2);
    expect(payload.dayWaitlist.map((entry) => entry.status)).toEqual(["waiting", "waiting"]);

    const outboxRows = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirmed' AND recipient_email = 'wait-all@example.test' ORDER BY created_at DESC LIMIT 1",
    );
    const emailPayload = JSON.parse(outboxRows[0].payload_json) as {
      isWaitlisted: boolean;
      hasActiveDayWaitlist: boolean;
      waitlistedDayCount: number;
      dayAttendance: Array<{ waitlistStatus: string }>;
    };

    expect(emailPayload.isWaitlisted).toBe(true);
    expect(emailPayload.hasActiveDayWaitlist).toBe(true);
    expect(emailPayload.waitlistedDayCount).toBe(2);
    expect(emailPayload.dayAttendance.map((entry) => entry.waitlistStatus)).toEqual(["waiting", "waiting"]);
  });

  it("sends offer and update emails with correct day-waitlist content for accept and expired-accept paths", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('holder', 'holder@example.test', 'holder@example.test', 'Holder', 'One', datetime('now'), datetime('now')),
          ('accept-user', 'accept-user@example.test', 'accept-user@example.test', 'Accept', 'User', datetime('now'), datetime('now')),
          ('expired-user', 'expired-user@example.test', 'expired-user@example.test', 'Expired', 'User', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const holder = await createRegistrationService(env.DB, {
      event,
      userId: "holder",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const acceptCandidate = await createRegistrationService(env.DB, {
      event,
      userId: "accept-user",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: acceptCandidate.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const expiredCandidate = await createRegistrationService(env.DB, {
      event,
      userId: "expired-user",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const expiredConfirmed = await confirmRegistrationByToken(env.DB, {
      token: expiredCandidate.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    await updateRegistrationById(
      env.DB,
      {
        registrationId: holder.registration.id,
        action: "cancel",
        waitlistClaimWindowHours: 24,
      },
      "test",
    );

    await promoteEventWaitlistWithNotifications(env.DB, {
      event,
      appBaseUrl: "https://app.test",
      claimWindowHours: 24,
      source: {
        actorType: "system",
        actorId: null,
        auditAction: "system_waitlist_promoted",
        source: "test",
      },
    });

    const offerPayloadRows = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_waitlist_offer' AND recipient_email = 'accept-user@example.test' ORDER BY created_at DESC LIMIT 1",
    );
    const offerPayload = await deliveredEmailPayload<{
      waitlistOfferNotice: boolean;
      manageUrl: string;
      dayAttendance: Array<{ statusLabel: string; waitlistStatus: string; isWaitlistOffer: boolean }>;
    }>(env.DB, env, offerPayloadRows[0].payload_json);
    const offeredManageToken = new URL(offerPayload.manageUrl).searchParams.get("token") as string;
    expect(offerPayload.waitlistOfferNotice).toBe(true);
    expect(offerPayload.dayAttendance[0].statusLabel).toBe("Waitlist offer sent");
    expect(offerPayload.dayAttendance[0].waitlistStatus).toBe("offered");
    expect(offerPayload.dayAttendance[0].isWaitlistOffer).toBe(true);

    const acceptResponse = await manageRegistration(
      createContext(
        env,
        new Request(`https://app.test/api/v1/registrations/manage/${offeredManageToken}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "update",
            attendanceType: "in_person",
            dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
          }),
        }),
        { token: offeredManageToken },
      ),
    );
    expect(acceptResponse.status).toBe(200);

    const acceptUpdateRows = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_updated' AND recipient_email = 'accept-user@example.test' ORDER BY created_at DESC LIMIT 1",
    );
    const acceptUpdatePayload = JSON.parse(acceptUpdateRows[0].payload_json) as {
      hasActiveDayWaitlist: boolean;
      waitlistedDayCount: number;
      dayAttendance: Array<{ statusLabel: string; waitlistStatus: string }>;
    };
    expect(acceptUpdatePayload.hasActiveDayWaitlist).toBe(false);
    expect(acceptUpdatePayload.waitlistedDayCount).toBe(0);
    expect(acceptUpdatePayload.dayAttendance[0].statusLabel).toBe("Confirmed in-person attendance");
    expect(acceptUpdatePayload.dayAttendance[0].waitlistStatus).toBe("accepted");

    await env.DB.prepare(
      `UPDATE event_day_waitlist_entries
       SET status = 'offered', offer_expires_at = datetime('now', '-1 hour'), updated_at = datetime('now')
       WHERE registration_id = ? AND event_day_id = 'day-1'`,
    )
      .bind(expiredConfirmed.registration.id)
      .run();

    const expiredResponse = await manageRegistration(
      createContext(
        env,
        new Request(`https://app.test/api/v1/registrations/manage/${expiredConfirmed.manageToken}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "update",
            attendanceType: "in_person",
            dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
          }),
        }),
        { token: expiredConfirmed.manageToken },
      ),
    );
    expect(expiredResponse.status).toBe(200);

    const expiredUpdateRows = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_updated' AND recipient_email = 'expired-user@example.test' ORDER BY created_at DESC LIMIT 1",
    );
    const expiredUpdatePayload = JSON.parse(expiredUpdateRows[0].payload_json) as {
      hasActiveDayWaitlist: boolean;
      waitlistedDayCount: number;
      dayAttendance: Array<{ statusLabel: string; waitlistStatus: string; isWaitlistOffer: boolean }>;
    };
    expect(expiredUpdatePayload.hasActiveDayWaitlist).toBe(true);
    expect(expiredUpdatePayload.waitlistedDayCount).toBe(1);
    expect(expiredUpdatePayload.dayAttendance[0].statusLabel).toBe("Waitlisted for in-person attendance");
    expect(expiredUpdatePayload.dayAttendance[0].waitlistStatus).toBe("waiting");
    expect(expiredUpdatePayload.dayAttendance[0].isWaitlistOffer).toBe(false);
  });

  it("rolls back registration cancellation when its participant projection fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES ('cancel-atomic-user', 'cancel-atomic@example.test', 'cancel-atomic@example.test',
               'Atomic', 'Cancel', datetime('now'), datetime('now'))`,
    ).run();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistrationService(env.DB, {
      event,
      userId: "cancel-atomic-user",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_cancel_participant_projection
       BEFORE UPDATE ON event_participants
       WHEN NEW.event_id = '${eventId}' AND NEW.user_id = 'cancel-atomic-user'
       BEGIN
         SELECT RAISE(ABORT, 'forced participant projection failure');
       END`,
    ).run();

    try {
      await expect(
        updateRegistrationById(
          env.DB,
          { registrationId: created.registration.id, action: "cancel", waitlistClaimWindowHours: 24 },
          "test",
        ),
      ).rejects.toBeTruthy();
      const [registration] = await queryAll<{ status: string; cancelled_at: string | null }>(
        env.DB,
        "SELECT status, cancelled_at FROM registrations WHERE id = ?",
        [created.registration.id],
      );
      const [participant] = await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_participants WHERE event_id = ? AND user_id = ? AND role = 'attendee'",
        [eventId, "cancel-atomic-user"],
      );
      expect(registration).toEqual({ status: "registered", cancelled_at: null });
      expect(participant.status).toBe("active");
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_cancel_participant_projection").run();
    }
  });

  it("records an unauthorized cancellation reason without expanding the constrained lifecycle status", async () => {
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES ('unauthorized-user', 'unauthorized@example.test', 'unauthorized@example.test',
               'Unauthorized', 'User', datetime('now'), datetime('now'))`,
    ).run();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistrationService(env.DB, {
      event,
      userId: "unauthorized-user",
      attendanceType: "virtual",
      sourceType: "direct",
      customAnswersJson: JSON.stringify({ confidential: "remove me" }),
      signingSecret: "test-signing-secret",
    });

    const updated = await updateRegistrationById(
      env.DB,
      {
        registrationId: created.registration.id,
        action: "report_unauthorized",
        waitlistClaimWindowHours: 24,
      },
      "test",
    );

    expect(updated.status).toBe("cancelled");
    expect(updated.cancellation_reason_code).toBe("unauthorized_registration");
    expect(updated.custom_answers_json).toBeNull();
    const [stored] = await queryAll<{
      status: string;
      cancellation_reason_code: string | null;
      custom_answers_json: string | null;
    }>(env.DB, "SELECT status, cancellation_reason_code, custom_answers_json FROM registrations WHERE id = ?", [
      created.registration.id,
    ]);
    expect(stored).toEqual({
      status: "cancelled",
      cancellation_reason_code: "unauthorized_registration",
      custom_answers_json: null,
    });
  });

  it("rolls back a managed update when its durable notification cannot be queued", async () => {
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES ('update-atomic-user', 'update-atomic@example.test', 'update-atomic@example.test',
               'Before', 'Update', datetime('now'), datetime('now'))`,
    ).run();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistrationService(env.DB, {
      event,
      userId: "update-atomic-user",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmed = await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_registration_update_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'registration_updated'
       BEGIN
         SELECT RAISE(ABORT, 'forced update outbox failure');
       END`,
    ).run();

    try {
      const response = await manageRegistration(
        createContext(
          env,
          new Request(`https://app.test/api/v1/registrations/manage/${confirmed.manageToken}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "update", attendanceType: "on_demand", firstName: "After" }),
          }),
          { token: confirmed.manageToken },
        ),
      );
      expect(response.status).toBe(500);
      const [registration] = await queryAll<{ attendance_type: string; status: string }>(
        env.DB,
        "SELECT attendance_type, status FROM registrations WHERE id = ?",
        [created.registration.id],
      );
      const [user] = await queryAll<{ first_name: string }>(env.DB, "SELECT first_name FROM users WHERE id = ?", [
        "update-atomic-user",
      ]);
      const audit = await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'self_service_update'",
        [created.registration.id],
      );
      expect(registration).toEqual({ attendance_type: "virtual", status: "registered" });
      expect(user.first_name).toBe("Before");
      expect(audit).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_registration_update_email").run();
    }
  });

  it("rolls back the complete managed email-change aggregate when confirmation queuing fails", async () => {
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES ('email-atomic-user', 'email-before@example.test', 'email-before@example.test',
               'Before', 'Email', datetime('now'), datetime('now'))`,
    ).run();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistrationService(env.DB, {
      event,
      userId: "email-atomic-user",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmed = await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_registration_email_change_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'registration_confirm_email'
       BEGIN
         SELECT RAISE(ABORT, 'forced email-change outbox failure');
       END`,
    ).run();

    try {
      const response = await manageRegistration(
        createContext(
          env,
          new Request(`https://app.test/api/v1/registrations/manage/${confirmed.manageToken}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "update",
              attendanceType: "on_demand",
              firstName: "After",
              email: "email-after@example.test",
            }),
          }),
          { token: confirmed.manageToken },
        ),
      );
      expect(response.status).toBe(500);
      const [registration] = await queryAll<{
        attendance_type: string;
        status: string;
        confirmation_link_secret: string | null;
      }>(env.DB, "SELECT attendance_type, status, confirmation_link_secret FROM registrations WHERE id = ?", [
        created.registration.id,
      ]);
      const [user] = await queryAll<{ first_name: string; pending_email: string | null }>(
        env.DB,
        "SELECT first_name, pending_email FROM users WHERE id = ?",
        ["email-atomic-user"],
      );
      const audits = await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_id = ? AND action IN ('self_service_update', 'email_changed')",
        [created.registration.id],
      );
      expect(registration).toEqual({
        attendance_type: "virtual",
        status: "registered",
        confirmation_link_secret: null,
      });
      expect(user).toEqual({ first_name: "Before", pending_email: null });
      expect(audits).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_registration_email_change_email").run();
    }
  });
});
