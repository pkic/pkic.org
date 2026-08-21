import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { processIncomingEmail, type IncomingRsvpEmail } from "../functions/_lib/services/calendar-rsvp-email-ingest";
import { recordCalendarRsvpEvent } from "../functions/_lib/services/calendar-rsvp";
import { generateSignedRsvpAddress, verifySignedRsvpAddressFull } from "../functions/_lib/email/rsvp";
import type { Env } from "../functions/_lib/types";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedRsvpRegistration } from "./helpers/rsvp";

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
    const calendarIcs = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      `UID:${registrationId}@pkic.org`,
      "ATTENDEE;PARTSTAT=ACCEPTED:mailto:alice@example.com",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    await processIncomingEmail(
      incomingEmail("alice@example.com", to, rawCalendarEmail(calendarIcs, "calendar-accept@example.test")),
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
