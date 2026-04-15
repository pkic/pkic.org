import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { hmacSha256Hex, sha256Hex } from "../functions/_lib/utils/crypto";
import { nowIso } from "../functions/_lib/utils/time";
import { createContext, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { onRequestPost } from "../functions/api/v1/internal/calendar/rsvp";
import type { Env } from "../functions/_lib/types";

interface RsvpRow {
  id: string;
  registration_id: string;
  ics_uid: string;
  attendee_email: string;
  response_status: string;
  source_message_id: string | null;
}

async function signBody(secret: string, body: string): Promise<{ timestamp: string; signature: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return { timestamp, signature };
}

async function seedRegistration(): Promise<{ registrationId: string }> {
  const eventId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events (
         id, slug, name, timezone, starts_at, ends_at, source_path,
         capacity_in_person, registration_mode, invite_limit_attendee,
         settings_json, created_at, updated_at
       ) VALUES (?, 'pqc-2026', 'PQC 2026', 'Europe/Amsterdam',
                 '2026-05-12T09:00:00.000Z', '2026-05-14T17:00:00.000Z',
                 'content/events/pqc-2026/_index.md', 100, 'open', 5,
                 '{}', ?, ?)`,
    ).bind(eventId, nowIso(), nowIso()),
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'alice@example.com', 'alice@example.com', 'user', 1, ?, ?)`,
    ).bind(userId, nowIso(), nowIso()),
    env.DB.prepare(
      `INSERT INTO registrations (
         id, event_id, user_id, status, attendance_type, source_type,
         manage_token_hash, created_at, updated_at
       ) VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, ?, ?)`,
    ).bind(registrationId, eventId, userId, await sha256Hex("manage-token"), nowIso(), nowIso()),
  ]);

  return { registrationId };
}

describe("POST /api/v1/internal/calendar/rsvp", () => {
  const internalSecret = "test-internal-secret";

  beforeEach(async () => {
    await resetDb();
  });

  it("rejects unsigned requests", async () => {
    const request = new Request("https://app.test/api/v1/internal/calendar/rsvp", {
      method: "POST",
      body: JSON.stringify({ uid: "x", partstat: "DECLINED" }),
      headers: { "content-type": "application/json" },
    });

    const context = createContext({ ...env, INTERNAL_SIGNING_SECRET: internalSecret } as Env, request, {});
    await expect(onRequestPost(context)).rejects.toMatchObject({
      status: 401,
      code: "INVALID_SIGNATURE",
    });
  });

  it("ingests a declined RSVP from calendarIcs and stores it", async () => {
    const { registrationId } = await seedRegistration();
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
    const request = new Request("https://app.test/api/v1/internal/calendar/rsvp", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-pkic-timestamp": signed.timestamp,
        "x-pkic-signature": signed.signature,
      },
    });

    const context = createContext({ ...env, INTERNAL_SIGNING_SECRET: internalSecret } as Env, request, {});
    const response = await onRequestPost(context);
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
    const { registrationId } = await seedRegistration();
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
      const request = new Request("https://app.test/api/v1/internal/calendar/rsvp", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-pkic-timestamp": signed.timestamp,
          "x-pkic-signature": signed.signature,
        },
      });

      const context = createContext({ ...env, INTERNAL_SIGNING_SECRET: internalSecret } as Env, request, {});
      const response = await onRequestPost(context);
      expect(response.status).toBe(200);
    }

    const rows = await queryAll<RsvpRow>(
      env.DB,
      "SELECT id, registration_id, ics_uid, attendee_email, response_status, source_message_id FROM calendar_rsvp_events",
    );
    expect(rows).toHaveLength(1);
  });
});
