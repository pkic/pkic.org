import { createExecutionContext } from "cloudflare:test";
import app from "./helpers/app";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processIncomingEmail, type IncomingRsvpEmail } from "../functions/_lib/services/calendar-rsvp-email-ingest";
import { recordCalendarRsvpEvent } from "../functions/_lib/services/calendar-rsvp";
import { generateSignedRsvpAddress, verifySignedRsvpAddressFull } from "../functions/_lib/email/rsvp";
import type { Env } from "../functions/_lib/types";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedRsvpRegistration } from "./helpers/rsvp";
import { calendarReplyIcs, deliveryStatusEmail, tnefRsvpEmail } from "./helpers/rsvp-email-fixtures";

const secret = "test-internal-secret";
const rsvpEmail = "rsvp@mail.pkic.org";

function testEnv(): Env {
  return { ...(env as unknown as Env), INTERNAL_SIGNING_SECRET: secret, RSVP_EMAIL: rsvpEmail } as Env;
}

function rawEmail(subject: string, messageId: string): string {
  return [
    "From: Alice <alice@example.com>",
    "To: RSVP <rsvp@mail.pkic.org>",
    `Message-ID: <${messageId}>`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    subject,
  ].join("\r\n");
}

function incomingEmail(from: string, to: string, raw: string): IncomingRsvpEmail {
  return {
    from,
    to,
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).byteLength,
  };
}

function rawCalendarEmail(calendarIcs: string, messageId: string): string {
  return [
    "From: Alice <alice@example.com>",
    "To: RSVP <rsvp@mail.pkic.org>",
    `Message-ID: <${messageId}>`,
    "Subject: Accepted: PQC 2026",
    "Content-Type: text/calendar; method=REPLY; charset=utf-8",
    "",
    calendarIcs,
  ].join("\r\n");
}

describe("incoming RSVP email persistence", () => {
  beforeEach(resetDb);

  it("records an implicit subject reply through the shared RSVP service", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    await processIncomingEmail(
      incomingEmail("alice@example.com", to, rawEmail("Declined: PQC 2026", "implicit-decline@example.test")),
      testEnv(),
    );

    const rows = await queryAll<{ response_status: string; provider: string; attendee_email: string }>(
      env.DB,
      "SELECT response_status, provider, attendee_email FROM calendar_rsvp_events",
    );
    expect(rows).toEqual([
      {
        response_status: "declined",
        provider: "cloudflare_email_routing_subject",
        attendee_email: "alice@example.com",
      },
    ]);
  });

  it("deduplicates repeated implicit email delivery by message ID", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    await processIncomingEmail(
      incomingEmail("alice@example.com", to, rawEmail("Accepted: PQC 2026", "duplicate-accept@example.test")),
      testEnv(),
    );
    await processIncomingEmail(
      incomingEmail("alice@example.com", to, rawEmail("Accepted: PQC 2026", "duplicate-accept@example.test")),
      testEnv(),
    );

    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toHaveLength(1);
  });

  it.each(["Accepted", "Declined", "Tentative"])(
    "records an Outlook %s reply using its author despite a rewritten envelope sender",
    async (response) => {
      const { registrationId } = await seedRsvpRegistration(env.DB);
      const dayId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) SELECT ?,event_id,'2026-05-13',created_at,updated_at FROM registrations WHERE id=?",
      )
        .bind(dayId, registrationId)
        .run();
      const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail, "2026-05-13");
      const raw = tnefRsvpEmail(`${response}: PQC 2026`, "outlook-reply@example.test");
      for (let attempt = 0; attempt < 2; attempt++)
        await processIncomingEmail(incomingEmail("prvs=1234567890=alice@example.com", to, raw), testEnv());
      expect(
        await queryAll(env.DB, "SELECT attendee_email,response_status,event_day_id,ics_uid FROM calendar_rsvp_events"),
      ).toEqual([
        {
          attendee_email: "alice@example.com",
          response_status: response.toLowerCase(),
          event_day_id: dayId,
          ics_uid: `${registrationId}-2026-05-13@pkic.org`,
        },
      ]);
    },
  );

  it.each([
    "",
    "From: invalid-address\r\n",
    "From: Alice <alice@example.com>, Mallory <mallory@example.test>\r\n",
    "From: Alice <alice@example.com>\r\nFrom: Mallory <mallory@example.test>\r\n",
  ])("refuses an invalid or ambiguous author without using the envelope sender: %s", async (from) => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = rawEmail("Accepted: PQC 2026", "invalid-author@example.test").replace(
      "From: Alice <alice@example.com>\r\n",
      from,
    );
    await expect(processIncomingEmail(incomingEmail("alice@example.com", to, raw), testEnv())).rejects.toMatchObject({
      status: 400,
    });
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toEqual([]);
  });

  it("refuses a subject reply whose author does not match the signed registration", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = rawEmail("Accepted: PQC 2026", "mismatched-author@example.test").replace(
      "alice@example.com",
      "mallory@example.test",
    );
    await expect(processIncomingEmail(incomingEmail("alice@example.com", to, raw), testEnv())).rejects.toMatchObject({
      code: "RSVP_EMAIL_RECIPIENT_MISMATCH",
    });
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toEqual([]);
  });

  it.each(["Status", "status", "sTaTuS"])(
    "records a delivery failure with a %s field and empty envelope sender",
    async (field) => {
      const { registrationId } = await seedRsvpRegistration(env.DB);
      const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
      for (let attempt = 0; attempt < 2; attempt++)
        await processIncomingEmail(
          incomingEmail("", to, deliveryStatusEmail().replace("Status: 5.1.1", `${field}: 5.1.1`)),
          testEnv(),
        );
      expect(
        await queryAll(env.DB, "SELECT attendee_email,response_status,provider FROM calendar_rsvp_events"),
      ).toEqual([
        {
          attendee_email: "alice@example.com",
          response_status: "bounced",
          provider: "cloudflare_email_routing_bounce",
        },
      ]);
    },
  );

  it("refuses delivery failures for a recipient outside the signed registration", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    await expect(
      processIncomingEmail(incomingEmail("", to, deliveryStatusEmail("mallory@example.test")), testEnv()),
    ).rejects.toMatchObject({ code: "RSVP_EMAIL_RECIPIENT_MISMATCH" });
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toEqual([]);
  });

  it.each([
    ["delayed", "4.2.0"],
    ["delivered", "2.0.0"],
  ])("does not turn a %s delivery report into an RSVP", async (action, status) => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = deliveryStatusEmail("alice@example.com", action, status).replace(
      "Subject: Delivery Status Notification",
      "Subject: Accepted: PQC 2026",
    );
    await processIncomingEmail(incomingEmail("", to, raw), testEnv());
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toEqual([]);
  });

  it("does not classify a reply as a bounce from its subject alone", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    await processIncomingEmail(
      incomingEmail(
        "alice@example.com",
        to,
        rawEmail("Accepted: bounce handling workshop", "bounce-topic@example.test"),
      ),
      testEnv(),
    );
    expect(await queryAll(env.DB, "SELECT response_status FROM calendar_rsvp_events")).toEqual([
      { response_status: "accepted" },
    ]);
  });

  it("propagates an awaited D1 failure and records a later SMTP retry only once", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = rawEmail("Accepted: PQC 2026", "smtp-retry@example.test");
    const message = () => ({
      ...incomingEmail("alice@example.com", to, raw),
      setReject: vi.fn(),
      forward: vi.fn(),
      reply: vi.fn(),
      headers: new Headers(),
    });
    const context = createExecutionContext();
    const waitUntil = vi.spyOn(context, "waitUntil");
    const failed = message();
    await expect(
      app.email(
        failed,
        {
          ...testEnv(),
          DB: {
            prepare: () => {
              throw new Error("D1_ERROR: Network connection lost.");
            },
            batch: vi.fn(),
          },
        },
        context,
      ),
    ).rejects.toThrow("D1_ERROR: Network connection lost.");
    expect(waitUntil).not.toHaveBeenCalled();
    expect(failed.setReject).not.toHaveBeenCalled();
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toHaveLength(0);
    await app.email(message(), testEnv(), createExecutionContext());
    await app.email(message(), testEnv(), createExecutionContext());
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toHaveLength(1);
  });

  it("defers processing when signing configuration is missing instead of acknowledging the message", async () => {
    await expect(
      processIncomingEmail(
        incomingEmail("alice@example.com", rsvpEmail, rawEmail("Accepted: PQC 2026", "missing-secret@example.test")),
        { ...testEnv(), INTERNAL_SIGNING_SECRET: undefined },
      ),
    ).rejects.toMatchObject({ code: "EMAIL_SIGNING_NOT_CONFIGURED" });
  });

  it("rejects a tampered RSVP address capability", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const signed = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const [local, domain] = signed.split("@");
    const finalCharacter = local.at(-1) === "0" ? "1" : "0";
    const tampered = `${local.slice(0, -1)}${finalCharacter}@${domain}`;
    await expect(verifySignedRsvpAddressFull(tampered, secret, rsvpEmail)).resolves.toBeNull();
  });

  it("round-trips a per-day 48-bit RSVP capability within the SMTP local-part limit", async () => {
    const registrationId = crypto.randomUUID();
    const dayDate = "2026-05-13";
    const signed = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail, dayDate);
    expect(signed.split("@")[0].length).toBeLessThanOrEqual(64);
    expect(signed).toMatch(/-[A-Za-z0-9_-]{8}@/);
    await expect(verifySignedRsvpAddressFull(signed, secret, rsvpEmail)).resolves.toEqual({
      registrationId,
      dayDate,
    });
  });

  it("parses calendar replies through the shared calendar RSVP parser", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const calendarIcs = calendarReplyIcs(registrationId);

    await processIncomingEmail(
      incomingEmail(
        "prvs=1234567890=alice@example.com",
        to,
        rawCalendarEmail(calendarIcs, "calendar-accept@example.test").replace(
          "Alice <alice@example.com>",
          "Delegate <delegate@example.test>",
        ),
      ),
      testEnv(),
    );

    await expect(
      queryAll<{ response_status: string; ics_uid: string }>(
        env.DB,
        "SELECT response_status, ics_uid FROM calendar_rsvp_events",
      ),
    ).resolves.toEqual([{ response_status: "accepted", ics_uid: `${registrationId}@pkic.org` }]);
  });

  it("does not collapse distinct calendar IDs containing the old delimiter", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const common = {
      registrationId,
      attendeeEmail: "alice@example.com",
      responseStatus: "accepted" as const,
      provider: "test",
      dedupeByCalendarUid: true,
    };
    await recordCalendarRsvpEvent(env.DB, {
      ...common,
      icsUid: `${registrationId}@pkic.org#a`,
      sourceMessageId: "b",
    });
    await recordCalendarRsvpEvent(env.DB, {
      ...common,
      icsUid: `${registrationId}@pkic.org`,
      sourceMessageId: "a#b",
    });

    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toHaveLength(2);
  });

  it("refuses a calendar attendee outside the signed registration despite a matching message author", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = rawCalendarEmail(
      calendarReplyIcs(registrationId, "mallory@example.test"),
      "wrong-attendee@example.test",
    );
    await expect(processIncomingEmail(incomingEmail("alice@example.com", to, raw), testEnv())).rejects.toMatchObject({
      code: "RSVP_EMAIL_RECIPIENT_MISMATCH",
    });
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toEqual([]);
  });

  it("does not infer a missing calendar attendee from the message author or envelope", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = rawCalendarEmail(calendarReplyIcs(registrationId, ""), "missing-attendee@example.test");
    await processIncomingEmail(incomingEmail("alice@example.com", to, raw), testEnv());
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toEqual([]);
  });

  it("refuses a delivery report with multiple failed recipients", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = deliveryStatusEmail(["alice@example.com", "mallory@example.test"]);
    await expect(processIncomingEmail(incomingEmail("", to, raw), testEnv())).rejects.toMatchObject({
      code: "RSVP_EMAIL_BOUNCE_AMBIGUOUS",
    });
    expect(await queryAll(env.DB, "SELECT id FROM calendar_rsvp_events")).toEqual([]);
  });

  it("logs validation fields and codes without exposing the claimed address", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const to = await generateSignedRsvpAddress(registrationId, secret, rsvpEmail);
    const raw = rawEmail("Accepted: PQC 2026", "invalid-email@example.test").replace(
      "alice@example.com",
      "prvs=1234567890=alice@example.com",
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(processIncomingEmail(incomingEmail("alice@example.com", to, raw), testEnv())).rejects.toMatchObject({
        code: "RSVP_EMAIL_ATTENDEE_INVALID",
      });
      const diagnostic = JSON.parse(String(logged.mock.calls.at(-1)?.[0]));
      expect(diagnostic.data).toMatchObject({
        code: "RSVP_EMAIL_ATTENDEE_INVALID",
        validation: { validationIssues: [{ field: "attendeeEmail", code: "invalid_format" }] },
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("alice@example.com");
    } finally {
      logged.mockRestore();
    }
  });

  it("rejects an oversized email before reading its stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream must not be read");
      },
    });
    await expect(
      processIncomingEmail(
        { from: "alice@example.com", to: rsvpEmail, raw: stream, rawSize: 65_537 },
        { ...testEnv(), RSVP_INBOUND_EMAIL_MAX_BYTES: "65536" },
      ),
    ).rejects.toMatchObject({ status: 413, code: "EMAIL_TOO_LARGE" });
  });
});
