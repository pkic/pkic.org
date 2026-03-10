import { describe, it, expect, vi } from "vitest";
import { createEnv, seedEventAndAdmin, createContext } from "./helpers/context";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { onRequestGet as referralRedirect } from "../functions/r/[code]";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { updateRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { queueEmail, processOutboxById } from "../functions/_lib/email/outbox";

describe("referral, waitlist, and calendar flows", () => {
  it("creates short referral redirect and tracks click", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const code = await createReferralCode(db, {
      eventId,
      ownerType: "registration",
      ownerId: crypto.randomUUID(),
      length: 7,
    });

    expect(code.length).toBe(7);

    const response = await referralRedirect(
      createContext(env, new Request(`https://app.test/r/${code}`), { code }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")?.includes(`ref=${code}`)).toBe(true);

    const stats = db.raw<{ clicks: number }>("SELECT clicks FROM referral_codes WHERE code = ?", [code]);
    expect(Number(stats[0].clicks)).toBe(1);
  });

  it("promotes waitlist when an in-person registration is cancelled", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);

    const personA = crypto.randomUUID();
    const personB = crypto.randomUUID();
    const regA = crypto.randomUUID();
    const regB = crypto.randomUUID();
    const manageTokenA = "manage-a";

    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
      VALUES
        ('${personA}', 'a@example.test', 'a@example.test', 'A', NULL, NULL, NULL, NULL, datetime('now'), datetime('now')),
        ('${personB}', 'b@example.test', 'b@example.test', 'B', NULL, NULL, NULL, NULL, datetime('now'), datetime('now'));
    `);

    const hashA = await sha256Hex(manageTokenA);

    await db.exec?.(`
      INSERT INTO registrations (
        id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
        custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
        manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
      ) VALUES
        ('${regA}', '${eventId}', '${personA}', NULL, 'registered', 'in_person', 'direct', NULL, NULL, NULL, NULL, NULL, '${hashA}', datetime('now'), NULL, datetime('now'), datetime('now')),
        ('${regB}', '${eventId}', '${personB}', NULL, 'waitlisted', 'in_person', 'direct', NULL, NULL, NULL, NULL, NULL, 'other-hash', datetime('now'), NULL, datetime('now'), datetime('now'));

      INSERT INTO waitlist_entries (id, event_id, registration_id, status, position, offer_expires_at, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${eventId}', '${regB}', 'waiting', 1, NULL, datetime('now'), datetime('now'));
    `);

    await updateRegistrationByManageToken(db, {
      manageToken: manageTokenA,
      action: "cancel",
      eventCapacity: 1,
      waitlistClaimWindowHours: 24,
    });

    const waitlist = db.raw<{ status: string }>(
      "SELECT status FROM waitlist_entries WHERE registration_id = ?",
      [regB],
    );
    expect(waitlist[0].status).toBe("offered");
  });

  it("logs calendar delivery after send", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const admin = db.raw<{ id: string }>("SELECT id FROM users LIMIT 1")[0];

    const template = await createTemplateVersion(db, {
      templateKey: "registration_confirmed",
      content: "Hello {{eventName}}",
      createdByUserId: admin.id,
      subjectTemplate: "Confirmed: {{eventName}}",
    });

    await activateTemplateVersion(db, {
      templateKey: "registration_confirmed",
      version: template.version,
    });

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();

    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
      VALUES ('${userId}', 'calendar@example.test', 'calendar@example.test', 'Calendar', 'User', NULL, NULL, NULL, datetime('now'), datetime('now'));

      INSERT INTO registrations (
        id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
        custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
        manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
      ) VALUES (
        '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'virtual',
        'direct', NULL, NULL, NULL, NULL, NULL, 'manage-hash', datetime('now'), NULL, datetime('now'), datetime('now')
      );
    `);

    const outboxId = await queueEmail(db, {
      eventId,
      templateKey: "registration_confirmed",
      recipientEmail: "calendar@example.test",
      recipientUserId: userId,
      subject: "Registration confirmed",
      messageType: "transactional",
      data: { eventName: "PQC Conference 2026" },
      calendar: {
        registrationId,
        eventId,
        icsUid: `${registrationId}@pkic.org`,
        icsContent: "BEGIN:VCALENDAR\nEND:VCALENDAR",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "msg-123" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    await processOutboxById(db, env, outboxId);
    vi.unstubAllGlobals();

    const outboxRows = db.raw<{ status: string; provider_message_id: string | null }>(
      "SELECT status, provider_message_id FROM email_outbox WHERE id = ?",
      [outboxId],
    );

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe("sent");
    expect(outboxRows[0].provider_message_id).toBe("msg-123");
  });
});
