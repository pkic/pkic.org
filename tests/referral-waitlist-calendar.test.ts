import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env as workerEnv } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll, createContext } from "./helpers/context";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { onRequestGet as referralRedirect } from "../functions/r/[code]";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { updateRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { buildBadgeAttachment } from "../functions/_lib/email/attachments";
import { queueEmail, processOutboxById } from "../functions/_lib/email/outbox";
import type { Env } from "../functions/_lib/types";

const env = workerEnv as unknown as Env;

describe("referral, waitlist, and calendar flows", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("creates short referral redirect and tracks click", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const code = await createReferralCode(env.DB, {
      eventId,
      ownerType: "registration",
      ownerId: crypto.randomUUID(),
      length: 7,
    });

    expect(code.length).toBe(7);

    const response = await referralRedirect(createContext(env, new Request(`https://app.test/r/${code}`), { code }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("/events/2026/pqc-2026/register/?event=pqc-2026");
    expect(html).toContain(`ref=${code}`);
    expect(html).toContain("source=referral_link");

    const stats = await queryAll<{ clicks: number }>(env.DB, "SELECT clicks FROM referral_codes WHERE code = ?", [
      code,
    ]);
    expect(Number(stats[0].clicks)).toBe(1);
  });

  it("does not auto-promote legacy event waitlist on cancellation", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const personA = crypto.randomUUID();
    const personB = crypto.randomUUID();
    const regA = crypto.randomUUID();
    const regB = crypto.randomUUID();
    const manageTokenA = "manage-a";

    await env.DB.prepare(
      `
      INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
      VALUES
        ('${personA}', 'a@example.test', 'a@example.test', 'A', NULL, NULL, NULL, NULL, datetime('now'), datetime('now')),
        ('${personB}', 'b@example.test', 'b@example.test', 'B', NULL, NULL, NULL, NULL, datetime('now'), datetime('now'));
    `,
    ).run();

    const hashA = await sha256Hex(manageTokenA);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
          custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
          manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
        ) VALUES
          ('${regA}', '${eventId}', '${personA}', NULL, 'registered', 'in_person', 'direct', NULL, NULL, NULL, NULL, NULL, '${hashA}', datetime('now'), NULL, datetime('now'), datetime('now')),
          ('${regB}', '${eventId}', '${personB}', NULL, 'waitlisted', 'in_person', 'direct', NULL, NULL, NULL, NULL, NULL, 'other-hash', datetime('now'), NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO waitlist_entries (id, event_id, registration_id, status, position, offer_expires_at, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', '${eventId}', '${regB}', 'waiting', 1, NULL, datetime('now'), datetime('now'))
      `),
    ]);

    await updateRegistrationByManageToken(env.DB, {
      manageToken: manageTokenA,
      action: "cancel",
      waitlistClaimWindowHours: 24,
    });

    const waitlist = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM waitlist_entries WHERE registration_id = ?",
      [regB],
    );
    expect(waitlist[0].status).toBe("waiting");
  });

  it("logs calendar delivery after send", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users LIMIT 1"))[0];

    const layout = await createTemplateVersion(env.DB, {
      templateKey: "email_layout",
      content: "{{{body_html}}}",
      createdByUserId: admin.id,
      subjectTemplate: "Email layout",
    });
    await activateTemplateVersion(env.DB, {
      templateKey: "email_layout",
      version: layout.version,
    });

    for (const [templateKey, content, subjectTemplate] of [
      ["partial_reg_details", "Registration details", "Partial: registration details"],
      ["partial_sponsors_block", "Sponsors block", "Partial: sponsors block"],
      ["partial_about_pkic", "About PKIC", "Partial: about PKIC"],
      ["partial_donation_request", "Donation request", "Partial: donation request"],
    ] as const) {
      const partial = await createTemplateVersion(env.DB, {
        templateKey,
        content,
        createdByUserId: admin.id,
        subjectTemplate,
      });
      await activateTemplateVersion(env.DB, {
        templateKey,
        version: partial.version,
      });
    }

    const template = await createTemplateVersion(env.DB, {
      templateKey: "registration_confirmed",
      content: "Hello {{eventName}}",
      createdByUserId: admin.id,
      subjectTemplate: "Confirmed: {{eventName}}",
    });

    await activateTemplateVersion(env.DB, {
      templateKey: "registration_confirmed",
      version: template.version,
    });

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${userId}', 'calendar@example.test', 'calendar@example.test', 'Calendar', 'User', NULL, NULL, NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
          custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
          manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'virtual',
          'direct', NULL, NULL, NULL, NULL, NULL, 'manage-hash', datetime('now'), NULL, datetime('now'), datetime('now')
        )
      `),
    ]);

    const outboxId = await queueEmail(env.DB, {
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
        icsFiles: [
          { uid: `${registrationId}@pkic.org`, filename: "invite.ics", content: "BEGIN:VCALENDAR\nEND:VCALENDAR" },
        ],
        inlineContent: "BEGIN:VCALENDAR\nEND:VCALENDAR",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "msg-123" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    await processOutboxById(env.DB, env, outboxId);
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const sendgridPayload = JSON.parse(String(requestInit?.body ?? "{}")) as {
      content?: Array<{ type?: string; value?: string }>;
      attachments?: Array<{ type?: string; filename?: string }>;
    };

    const calendarContent = (sendgridPayload.content ?? []).find((item) =>
      (item.type ?? "").toLowerCase().includes("text/calendar"),
    );
    expect(calendarContent?.type).toBe("text/calendar; method=REQUEST");
    expect(calendarContent?.value).toContain("BEGIN:VCALENDAR");

    const calendarAttachment = (sendgridPayload.attachments ?? []).find((item) => item.filename === "invite.ics");
    expect(calendarAttachment?.type).toBe("application/ics");

    const outboxRows = await queryAll<{ status: string; provider_message_id: string | null }>(
      env.DB,
      "SELECT status, provider_message_id FROM email_outbox WHERE id = ?",
      [outboxId],
    );

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe("sent");
    expect(outboxRows[0].provider_message_id).toBe("msg-123");
  });

  it("uses the payload URL origin for email layout assets during background send", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users LIMIT 1"))[0];

    const layout = await createTemplateVersion(env.DB, {
      templateKey: "email_layout",
      content: '<img src="{{baseUrl}}/img/logo-white.png" alt="PKIC"> {{{body_html}}}',
      createdByUserId: admin.id,
      subjectTemplate: "Email layout",
    });
    await activateTemplateVersion(env.DB, {
      templateKey: "email_layout",
      version: layout.version,
    });

    for (const [templateKey, content, subjectTemplate] of [
      ["partial_reg_details", "Registration details", "Partial: registration details"],
      ["partial_sponsors_block", "Sponsors block", "Partial: sponsors block"],
      ["partial_about_pkic", "About PKIC", "Partial: about PKIC"],
      ["partial_donation_request", "Donation request", "Partial: donation request"],
    ] as const) {
      const partial = await createTemplateVersion(env.DB, {
        templateKey,
        content,
        createdByUserId: admin.id,
        subjectTemplate,
      });
      await activateTemplateVersion(env.DB, {
        templateKey,
        version: partial.version,
      });
    }

    const template = await createTemplateVersion(env.DB, {
      templateKey: "registration_confirm_email",
      content: "Confirm here: [confirm]({{confirmationUrl}})",
      createdByUserId: admin.id,
      subjectTemplate: "Confirm: {{eventName}}",
    });
    await activateTemplateVersion(env.DB, {
      templateKey: "registration_confirm_email",
      version: template.version,
    });

    const outboxId = await queueEmail(env.DB, {
      eventId,
      baseUrl: "https://preview.pkic.org",
      templateKey: "registration_confirm_email",
      recipientEmail: "confirm@example.test",
      recipientUserId: null,
      subject: "Confirm",
      messageType: "transactional",
      data: {
        eventName: "PQC Conference 2026",
        confirmationUrl: "https://preview.pkic.org/events/test/confirm/?token=abc",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "msg-456" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    await processOutboxById(env.DB, env, outboxId);
    vi.unstubAllGlobals();

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const sendgridPayload = JSON.parse(String(requestInit?.body ?? "{}")) as {
      content?: Array<{ type?: string; value?: string }>;
    };
    const htmlContent = (sendgridPayload.content ?? []).find((item) => item.type === "text/html")?.value ?? "";

    expect(htmlContent).toContain("https://preview.pkic.org/img/logo-white.png");
    expect(htmlContent).toContain("https://preview.pkic.org/events/test/confirm/?token=abc");
    expect(htmlContent).not.toContain("http://localhost/img/logo-white.png");
  });

  it("attaches donation badges with a donation-specific filename and corrected jpeg extension", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users LIMIT 1"))[0];

    const layout = await createTemplateVersion(env.DB, {
      templateKey: "email_layout",
      content: "{{{body_html}}}",
      createdByUserId: admin.id,
      subjectTemplate: "Email layout",
    });
    await activateTemplateVersion(env.DB, {
      templateKey: "email_layout",
      version: layout.version,
    });

    for (const [templateKey, content, subjectTemplate] of [
      ["partial_reg_details", "Registration details", "Partial: registration details"],
      ["partial_sponsors_block", "Sponsors block", "Partial: sponsors block"],
      ["partial_about_pkic", "About PKIC", "Partial: about PKIC"],
      ["partial_donation_request", "Donation request", "Partial: donation request"],
    ] as const) {
      const partial = await createTemplateVersion(env.DB, {
        templateKey,
        content,
        createdByUserId: admin.id,
        subjectTemplate,
      });
      await activateTemplateVersion(env.DB, {
        templateKey,
        version: partial.version,
      });
    }

    const template = await createTemplateVersion(env.DB, {
      templateKey: "donation_thank_you",
      content: "Thanks {{name}}",
      createdByUserId: admin.id,
      subjectTemplate: "Thanks {{firstName}}",
    });
    await activateTemplateVersion(env.DB, {
      templateKey: "donation_thank_you",
      version: template.version,
    });

    const outboxId = await queueEmail(env.DB, {
      templateKey: "donation_thank_you",
      recipientEmail: "donor@example.test",
      recipientUserId: null,
      subject: "Thanks",
      messageType: "transactional",
      attachments: [
        buildBadgeAttachment({
          badgeCode: "donation-cs_test_123",
          badgeType: "donation",
          firstName: "Ada",
          name: "Ada Lovelace",
        }),
      ],
      data: {
        firstName: "Ada",
        name: "Ada Lovelace",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "msg-789" },
      }),
    );

    const testEnv = {
      ...env,
      ASSETS_BUCKET: {
        get: vi.fn().mockResolvedValue({
          httpMetadata: { contentType: "image/png" },
          arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer),
        }),
      },
    };

    vi.stubGlobal("fetch", fetchMock);
    await processOutboxById(env.DB, testEnv as unknown as Env, outboxId);
    vi.unstubAllGlobals();

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const sendgridPayload = JSON.parse(String(requestInit?.body ?? "{}")) as {
      attachments?: Array<{ filename?: string; type?: string }>;
    };
    const badgeAttachment = (sendgridPayload.attachments ?? []).find((item) => item.type === "image/jpeg");

    expect(badgeAttachment?.filename).toBe("donation-badge-ada.jpg");
  });

  it("attaches attendee badges from queued attachment descriptors", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users LIMIT 1"))[0];

    const layout = await createTemplateVersion(env.DB, {
      templateKey: "email_layout",
      content: "{{{body_html}}}",
      createdByUserId: admin.id,
      subjectTemplate: "Email layout",
    });
    await activateTemplateVersion(env.DB, {
      templateKey: "email_layout",
      version: layout.version,
    });

    for (const [templateKey, content, subjectTemplate] of [
      ["partial_reg_details", "Registration details", "Partial: registration details"],
      ["partial_sponsors_block", "Sponsors block", "Partial: sponsors block"],
      ["partial_about_pkic", "About PKIC", "Partial: about PKIC"],
      ["partial_donation_request", "Donation request", "Partial: donation request"],
    ] as const) {
      const partial = await createTemplateVersion(env.DB, {
        templateKey,
        content,
        createdByUserId: admin.id,
        subjectTemplate,
      });
      await activateTemplateVersion(env.DB, {
        templateKey,
        version: partial.version,
      });
    }

    const template = await createTemplateVersion(env.DB, {
      templateKey: "registration_confirmed",
      content: "Thanks {{firstName}}",
      createdByUserId: admin.id,
      subjectTemplate: "Welcome {{firstName}}",
    });
    await activateTemplateVersion(env.DB, {
      templateKey: "registration_confirmed",
      version: template.version,
    });

    const outboxId = await queueEmail(env.DB, {
      templateKey: "registration_confirmed",
      recipientEmail: "attendee@example.test",
      recipientUserId: null,
      subject: "Welcome",
      messageType: "transactional",
      attachments: [
        buildBadgeAttachment({
          badgeCode: "event_ref_123",
          badgeType: "attendee",
          firstName: "Paul",
        }),
      ],
      data: {
        firstName: "Paul",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-message-id": "msg-790" },
      }),
    );

    const testEnv = {
      ...env,
      ASSETS_BUCKET: {
        get: vi.fn().mockResolvedValue({
          httpMetadata: { contentType: "image/png" },
          arrayBuffer: vi
            .fn()
            .mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer),
        }),
      },
    };

    vi.stubGlobal("fetch", fetchMock);
    await processOutboxById(env.DB, testEnv as unknown as Env, outboxId);
    vi.unstubAllGlobals();

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const sendgridPayload = JSON.parse(String(requestInit?.body ?? "{}")) as {
      attachments?: Array<{ filename?: string; type?: string }>;
    };
    const badgeAttachment = (sendgridPayload.attachments ?? []).find((item) => item.type === "image/png");

    expect(badgeAttachment?.filename).toBe("attendee-badge-paul.png");
  });
});
