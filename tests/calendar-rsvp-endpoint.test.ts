import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { hmacSha256Hex } from "../functions/_lib/utils/crypto";
import { INTERNAL_CALENDAR_RSVP_MAX_BYTES } from "../functions/_lib/http-body";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedRsvpRegistration } from "./helpers/rsvp";
import app from "../functions/router";
import type { Env } from "../functions/_lib/types";

interface RsvpRow {
  id: string;
  registration_id: string;
  ics_uid: string;
  attendee_email: string;
  response_status: string;
  source_message_id: string | null;
}

async function signBody(
  secret: string,
  body: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
): Promise<{ timestamp: string; signature: string }> {
  const signature = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return { timestamp, signature };
}

function callApp(request: Request): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      request,
      { ...(env as unknown as Env), INTERNAL_SIGNING_SECRET: internalSecret } as Env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as unknown as ExecutionContext,
    ),
  );
}

const internalSecret = "test-internal-secret";

describe("POST /api/v1/calendar/rsvp", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects unsigned requests", async () => {
    const request = new Request("https://app.test/api/v1/calendar/rsvp", {
      method: "POST",
      body: JSON.stringify({
        provider: "cloudflare_email_route",
        sourceMessageId: "unsigned-message",
        uid: `${crypto.randomUUID()}@pkic.org`,
        partstat: "DECLINED",
        attendeeEmail: "alice@example.com",
      }),
      headers: { "content-type": "application/json" },
    });

    const response = await callApp(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
  });

  it("ingests a declined RSVP from calendarIcs and stores it", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const uid = `${registrationId}@pkic.org`;
    const body = JSON.stringify({
      provider: "cloudflare_email_route",
      sourceMessageId: "msg-123",
      calendarIcs: [
        "BEGIN:VCALENDAR",
        "METHOD:REPLY",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        "SEQUENCE:2",
        "ATTENDEE;PARTSTAT=DECLINED:mailto:alice@example.com",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const signed = await signBody(internalSecret, body);
    const request = new Request("https://app.test/api/v1/calendar/rsvp", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-pkic-timestamp": signed.timestamp,
        "x-pkic-signature": signed.signature,
      },
    });

    const response = await callApp(request);
    expect(response.status).toBe(200);

    const rows = await queryAll<RsvpRow>(
      env.DB,
      "SELECT id, registration_id, ics_uid, attendee_email, response_status, source_message_id FROM calendar_rsvp_events",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.registration_id).toBe(registrationId);
    expect(rows[0]?.ics_uid).toBe(uid);
    expect(rows[0]?.attendee_email).toBe("alice@example.com");
    expect(rows[0]?.response_status).toBe("declined");
    expect(rows[0]?.source_message_id).toBe("msg-123");
  });

  it("deduplicates repeated webhook deliveries by sourceMessageId", async () => {
    const { registrationId } = await seedRsvpRegistration(env.DB);
    const uid = `${registrationId}@pkic.org`;

    const payload = {
      provider: "cloudflare_email_route",
      sourceMessageId: "msg-duplicate",
      uid,
      partstat: "DECLINED",
      attendeeEmail: "alice@example.com",
    };

    for (let i = 0; i < 2; i += 1) {
      const body = JSON.stringify(payload);
      const signed = await signBody(internalSecret, body);
      const request = new Request("https://app.test/api/v1/calendar/rsvp", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-pkic-timestamp": signed.timestamp,
          "x-pkic-signature": signed.signature,
        },
      });

      const response = await callApp(request);
      expect(response.status).toBe(200);
    }

    const rows = await queryAll<RsvpRow>(
      env.DB,
      "SELECT id, registration_id, ics_uid, attendee_email, response_status, source_message_id FROM calendar_rsvp_events",
    );
    expect(rows).toHaveLength(1);
  });

  it.each([-600, 600])("rejects signatures outside the replay window (%i seconds)", async (offsetSeconds) => {
    const body = JSON.stringify({
      provider: "cloudflare_email_route",
      sourceMessageId: `replay-${offsetSeconds}`,
      uid: `${crypto.randomUUID()}@pkic.org`,
      partstat: "DECLINED",
      attendeeEmail: "alice@example.com",
    });
    const timestamp = String(Math.floor(Date.now() / 1000) + offsetSeconds);
    const signed = await signBody(internalSecret, body, timestamp);
    const response = await callApp(
      new Request("https://app.test/api/v1/calendar/rsvp", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-pkic-timestamp": signed.timestamp,
          "x-pkic-signature": signed.signature,
        },
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_SIGNATURE" } });
  });

  it("rejects a valid-length signature for a different body", async () => {
    const body = JSON.stringify({
      provider: "cloudflare_email_route",
      sourceMessageId: "tampered",
      uid: `${crypto.randomUUID()}@pkic.org`,
      partstat: "DECLINED",
      attendeeEmail: "alice@example.com",
    });
    const signed = await signBody(internalSecret, `${body} `);
    const response = await callApp(
      new Request("https://app.test/api/v1/calendar/rsvp", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-pkic-timestamp": signed.timestamp,
          "x-pkic-signature": signed.signature,
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("bounds the signed body before retaining or parsing it", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await callApp(
      new Request("https://app.test/api/v1/calendar/rsvp", {
        method: "POST",
        body: "x".repeat(INTERNAL_CALENDAR_RSVP_MAX_BYTES + 1),
        headers: {
          "content-type": "application/json",
          "x-pkic-timestamp": timestamp,
          "x-pkic-signature": "0".repeat(64),
        },
      }),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "REQUEST_BODY_TOO_LARGE" } });
  });

  it("does not report success when the signed UID references no registration", async () => {
    const body = JSON.stringify({
      provider: "cloudflare_email_route",
      sourceMessageId: "missing-registration",
      uid: `${crypto.randomUUID()}@pkic.org`,
      partstat: "ACCEPTED",
      attendeeEmail: "alice@example.com",
    });
    const signed = await signBody(internalSecret, body);
    const response = await callApp(
      new Request("https://app.test/api/v1/calendar/rsvp", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-pkic-timestamp": signed.timestamp,
          "x-pkic-signature": signed.signature,
        },
      }),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "REGISTRATION_NOT_FOUND" } });
  });
});
