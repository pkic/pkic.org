import app from "../functions/router";
import { hmacSha256Hex } from "../functions/_lib/utils/crypto";
import { agendaOccurrenceCalendarUid } from "../assets/shared/event-agenda-calendar-identity";
import { processIncomingEmail } from "../functions/_lib/services/calendar-rsvp-email-ingest";
import { sessionBookings } from "../functions/_lib/services/event-participation/reporting";
import type { Env } from "../functions/_lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import ICAL from "ical.js";
import { resetDb } from "./helpers/reset-db";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { setSessionInvitation } from "../functions/_lib/services/event-participation/invitations";
import { recordSessionInvitationRsvp } from "../functions/_lib/services/event-participation/session-rsvp";
import { recordCalendarRsvpEvent, parseCalendarRsvp } from "../functions/_lib/services/calendar-rsvp";
import { verifySignedRsvpAddressFull } from "../functions/_lib/email/rsvp";
import type { DatabaseLike } from "../functions/_lib/types";
const eventId = crypto.randomUUID(),
  userId = crypto.randomUUID(),
  otherId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  roomId = crypto.randomUUID();
const invitationSequences = new Map<string, number>();
const email = `${userId}@example.test`,
  secret = "local-session-rsvp-test-secret";
async function invite(mode: "physical" | "remote" = "physical") {
  await setSessionInvitation(
    env.DB,
    eventId,
    sessionId,
    userId,
    {
      userId,
      attendanceMode: mode,
      roomId: mode === "physical" ? roomId : null,
      action: "invite",
      reasonCode: "organizer_invitation",
    },
    { secret },
  );
  const row = (await env.DB.prepare(
    "SELECT id,reply_sequence FROM agenda_session_invitations WHERE occurrence_id=? AND user_id=?",
  )
    .bind(sessionId, userId)
    .first<{ id: string; reply_sequence: number }>())!;
  invitationSequences.set(row.id, row.reply_sequence);
  return row.id;
}
function reply(
  invitationId: string,
  responseStatus: "accepted" | "declined" | "tentative" = "accepted",
  message = crypto.randomUUID(),
) {
  return {
    invitationId,
    attendeeEmail: email,
    responseStatus,
    provider: "test-calendar",
    sourceMessageId: message,
    icsUid: `${invitationId}@session-rsvp.pkic.org`,
    invitationSequence: invitationSequences.get(invitationId) ?? 0,
  };
}
async function status() {
  return (
    await env.DB.prepare("SELECT status FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?")
      .bind(sessionId, userId)
      .first<{ status: string }>()
  )?.status;
}
async function alterPublished(field: string, value: unknown) {
  await env.DB.prepare(
    "UPDATE event_agenda_publications SET snapshot_json=json_set(snapshot_json,?,json(?)) WHERE event_id=?",
  )
    .bind(`$.occurrences[0].${field}`, JSON.stringify(value), eventId)
    .run();
}
describe("Signed recipient session calendar replies", () => {
  beforeEach(async () => {
    await resetDb();
    invitationSequences.clear();
    const now = new Date().toISOString(),
      start = new Date(Date.now() + 3600000).toISOString(),
      end = new Date(Date.now() + 7200000).toISOString();
    for (const id of [userId, otherId])
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'session-rsvp','Session RSVP','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    for (const id of [userId, otherId])
      await env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, id, crypto.randomUUID(), now, now)
        .run();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Selected room',1)")
      .bind(roomId, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,room_id,start_at,end_at,admission_policy,capacity,remote_capacity) VALUES(?,?,'Invited session',?,?,?,'reservation',1,1)",
    )
      .bind(sessionId, eventId, roomId, start, end)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "session-rsvp");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), userId, now)
      .run();
  });
  it("emits signed REQUEST, dispatches recipient reply, handles repeat and legitimate decline without feed authority", async () => {
    const id = await invite();
    const row = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE recipient_user_id=? AND template_key='agenda_session_invitation'",
    )
      .bind(userId)
      .first<{ payload_json: string }>();
    const payload = JSON.parse(row!.payload_json);
    expect((await verifySignedRsvpAddressFull(payload.__replyTo, secret))?.registrationId).toBe(id);
    expect(await verifySignedRsvpAddressFull(payload.__replyTo, secret + "wrong")).toBeNull();
    const calendar = new ICAL.Component(ICAL.parse(payload.__calendarInvite.inlineContent));
    expect(calendar.getFirstPropertyValue("method")).toBe("REQUEST");
    expect(calendar.getFirstSubcomponent("vevent")!.getFirstPropertyValue("location")).toBe("Selected room");
    const input = reply(id);
    await recordCalendarRsvpEvent(env.DB, { ...input, registrationId: id });
    expect(await status()).toBe("reserved");
    await recordCalendarRsvpEvent(env.DB, { ...input, registrationId: id });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_session_rsvp_receipts").first<{ n: number }>())!.n,
    ).toBe(1);
    expect((await recordSessionInvitationRsvp(env.DB, reply(id, "tentative")))?.disposition).toBe("tentative");
    expect(await status()).toBe("reserved");
    expect((await recordSessionInvitationRsvp(env.DB, reply(id, "declined")))?.disposition).toBe("applied");
    expect(await status()).toBe("canceled");
    await expect(
      recordSessionInvitationRsvp(env.DB, { ...reply(id), attendeeEmail: `${otherId}@example.test` }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await recordSessionInvitationRsvp(env.DB, reply(crypto.randomUUID()))).toBeNull();
  });
  it("preserves the established place for stale organizer sequence, material change and reordered claimed client time", async () => {
    const id = await invite();
    await recordSessionInvitationRsvp(env.DB, reply(id));
    expect(
      (await recordSessionInvitationRsvp(env.DB, { ...reply(id, "declined"), invitationSequence: 1 }))?.disposition,
    ).toBe("needs_review");
    await alterPublished("title", "Changed invitation context");
    expect((await recordSessionInvitationRsvp(env.DB, reply(id, "declined")))?.disposition).toBe("needs_review");
    expect(await status()).toBe("reserved");
    await alterPublished("title", "Invited session");
    const stamp = new Date().toISOString();
    await recordSessionInvitationRsvp(env.DB, { ...reply(id), claimedReplyAt: stamp });
    expect(
      (await recordSessionInvitationRsvp(env.DB, { ...reply(id, "declined"), claimedReplyAt: stamp }))?.disposition,
    ).toBe("needs_review");
    expect(await status()).toBe("reserved");
  });
  it("queues a full session rather than claiming a seat and keeps approval as a request", async () => {
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at,room_id) VALUES(?,?,?,?,'physical','reserved',?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        sessionId,
        otherId,
        new Date().toISOString(),
        new Date().toISOString(),
        roomId,
      )
      .run();
    let id = await invite();
    await recordSessionInvitationRsvp(env.DB, reply(id));
    expect(await status()).toBe("waitlisted");
    await alterPublished("admissionPolicy", "approval");
    id = await invite();
    await recordSessionInvitationRsvp(env.DB, reply(id));
    expect(await status()).toBe("approval_pending");
  });
  it("saves preference only and rejects mismatched mode/day event registration", async () => {
    await alterPublished("admissionPolicy", "preference");
    let id = await invite();
    await recordSessionInvitationRsvp(env.DB, reply(id));
    expect(await status()).toBe("saved");
    await alterPublished("admissionPolicy", "reservation");
    id = await invite("remote");
    expect((await recordSessionInvitationRsvp(env.DB, reply(id)))?.disposition).toBe("rejected");
    const result = await sessionBookings(env.DB, eventId, sessionId, { limit: 10, offset: 0 });
    expect(result.participants[0].calendarReplyDisposition).toBe("rejected");
    expect(await status()).toBe("saved");
  });
  it("rolls back all receipt/calendar side effects if recipient authority changes before the atomic batch", async () => {
    const id = await invite();
    let raced = false;
    const db: DatabaseLike = {
      prepare: (q) => env.DB.prepare(q),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          await env.DB.prepare("UPDATE agenda_session_invitations SET revoked_at=? WHERE id=?")
            .bind(new Date().toISOString(), id)
            .run();
        }
        return env.DB.batch(statements);
      },
    };
    await expect(recordSessionInvitationRsvp(db, reply(id))).rejects.toMatchObject({
      code: "SESSION_RSVP_CONTEXT_CHANGED",
    });
    expect(await status()).toBe("saved");
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_session_rsvp_receipts").first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it("converges concurrent duplicate replies and rejects changed payload under the same message identity", async () => {
    const id = await invite(),
      input = reply(id);
    const result = await Promise.all([
      recordSessionInvitationRsvp(env.DB, input),
      recordSessionInvitationRsvp(env.DB, input),
    ]);
    expect(result.map((r) => r?.disposition)).toEqual(["applied", "applied"]);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_session_rsvp_receipts").first<{ n: number }>())!.n,
    ).toBe(1);
    await expect(recordSessionInvitationRsvp(env.DB, { ...input, responseStatus: "declined" })).rejects.toMatchObject({
      code: "SESSION_RSVP_REPLAY_CONFLICT",
    });
  });
  it("uses actual signed email ingestion and ignores invalid signatures before any participation or receipt", async () => {
    await invite();
    const row = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key='agenda_session_invitation' AND recipient_user_id=? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(userId)
      .first<{ payload_json: string }>();
    const address = JSON.parse(row!.payload_json).__replyTo as string;
    const incoming = (to: string, messageId: string) => {
      const raw = `From: ${email}\r\nTo: ${to}\r\nMessage-ID: <${messageId}@example.test>\r\nSubject: Accepted: Invited session\r\nContent-Type: text/plain\r\n\r\nAccepted`;
      return { from: email, to, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
    };
    await processIncomingEmail(incoming(address, "invalid"), {
      ...env,
      RSVP_EMAIL: "rsvp@mail.pkic.org",
      INTERNAL_SIGNING_SECRET: secret + "wrong",
    } as Env);
    expect(await status()).toBe("saved");
    await processIncomingEmail(incoming(address, "valid"), {
      ...env,
      RSVP_EMAIL: "rsvp@mail.pkic.org",
      INTERNAL_SIGNING_SECRET: secret,
    } as Env);
    expect(await status()).toBe("reserved");
    const result = await sessionBookings(env.DB, eventId, sessionId, { limit: 10, offset: 0 });
    expect(result.participants[0].calendarReplyDisposition).toBe("applied");
    expect(result.participants[0].calendarReplyResponse).toBe("accepted");
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
      .bind(eventId, userId)
      .run();
    await processIncomingEmail(incoming(address, "known-business-refusal"), {
      ...env,
      RSVP_EMAIL: "rsvp@mail.pkic.org",
      INTERNAL_SIGNING_SECRET: secret,
    } as Env);
    const refused = await sessionBookings(env.DB, eventId, sessionId, { limit: 10, offset: 0 });
    expect(refused.participants[0].calendarReplyDisposition).toBe("rejected");
  });
  it("rechecks the last seat inside canonical booking when another recipient wins before the batch", async () => {
    const id = await invite();
    let raced = false;
    const db: DatabaseLike = {
      prepare: (q) => env.DB.prepare(q),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          const now = new Date().toISOString();
          await env.DB.prepare(
            "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at,room_id) VALUES(?,?,?,?,'physical','reserved',?,?,?)",
          )
            .bind(crypto.randomUUID(), eventId, sessionId, otherId, now, now, roomId)
            .run();
        }
        return env.DB.batch(statements);
      },
    };
    expect((await recordSessionInvitationRsvp(db, reply(id)))?.participationStatus).toBe("waitlisted");
    expect(await status()).toBe("waitlisted");
  });
  it("records configured-day refusal and missing registration without inventing admission, and SMTP retry is idempotent", async () => {
    const session = await env.DB.prepare("SELECT start_at FROM event_agenda_occurrences WHERE id=?")
      .bind(sessionId)
      .first<{ start_at: string }>();
    const now = new Date().toISOString(),
      day = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,in_person_capacity,created_at,updated_at) VALUES(?,?,?,10,?,?)",
    )
      .bind(day, eventId, session!.start_at.slice(0, 10), now, now)
      .run();
    let id = await invite();
    const input = reply(id);
    expect((await recordSessionInvitationRsvp(env.DB, input))?.disposition).toBe("rejected");
    expect((await recordSessionInvitationRsvp(env.DB, input))?.disposition).toBe("rejected");
    expect(await status()).toBe("saved");
    await env.DB.prepare("DELETE FROM event_days WHERE id=?").bind(day).run();
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
      .bind(eventId, userId)
      .run();
    id = await invite();
    expect((await recordSessionInvitationRsvp(env.DB, reply(id)))?.disposition).toBe("rejected");
    expect(await status()).toBe("saved");
  });
  it("preserves definite context races and transient storage failures for retry without durable receipts", async () => {
    const id = await invite();
    let raced = false;
    const changed: DatabaseLike = {
      prepare: (q) => env.DB.prepare(q),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          await alterPublished("title", "Changed while reply was processing");
        }
        return env.DB.batch(statements);
      },
    };
    await expect(recordSessionInvitationRsvp(changed, reply(id))).rejects.toMatchObject({
      code: "SESSION_RSVP_CONTEXT_CHANGED",
    });
    expect(await status()).toBe("saved");
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_session_rsvp_receipts").first<{ n: number }>())!.n,
    ).toBe(0);
    await alterPublished("title", "Invited session");
    const failing: DatabaseLike = {
      prepare: (q) => env.DB.prepare(q),
      batch: async () => {
        throw new Error("transient D1 storage unavailable");
      },
    };
    await expect(recordSessionInvitationRsvp(failing, reply(id))).rejects.toThrow("transient D1 storage unavailable");
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM agenda_session_rsvp_receipts").first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it("updates the same calendar occurrence across reissues and moves, with monotonically increasing sequence and signed HTTP target binding", async () => {
    const requestPayload = async (id: string) =>
      JSON.parse(
        (await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE idempotency_key=?")
          .bind(`agenda-invitation:${id}`)
          .first<{ payload_json: string }>())!.payload_json,
      );
    const oldId = await invite(),
      oldPayload = await requestPayload(oldId);
    const oldEntry = new ICAL.Component(ICAL.parse(oldPayload.__calendarInvite.inlineContent)).getFirstSubcomponent(
      "vevent",
    )!;
    expect(oldEntry.getFirstPropertyValue("uid")).toBe(agendaOccurrenceCalendarUid(sessionId));
    expect(oldEntry.getFirstPropertyValue("sequence")).toBe(0);
    let id = await invite("remote"),
      payload = await requestPayload(id);
    let entry = new ICAL.Component(ICAL.parse(payload.__calendarInvite.inlineContent)).getFirstSubcomponent("vevent")!;
    expect(entry.getFirstPropertyValue("uid")).toBe(oldEntry.getFirstPropertyValue("uid"));
    expect(entry.getFirstPropertyValue("sequence")).toBe(1);
    const start = new Date(Date.now() + 10800000).toISOString(),
      end = new Date(Date.now() + 14400000).toISOString();
    await alterPublished("startAt", start);
    await alterPublished("endAt", end);
    id = await invite();
    payload = await requestPayload(id);
    entry = new ICAL.Component(ICAL.parse(payload.__calendarInvite.inlineContent)).getFirstSubcomponent("vevent")!;
    expect(entry.getFirstPropertyValue("uid")).toBe(oldEntry.getFirstPropertyValue("uid"));
    expect(entry.getFirstPropertyValue("sequence")).toBe(2);
    expect((entry.getFirstPropertyValue("dtstart") as ICAL.Time).toJSDate().toISOString()).toBe(
      start.slice(0, 19) + ".000Z",
    );
    const post = async (organizerEmail: string | undefined, invitationSequence = 2) => {
      const body = JSON.stringify({
        uid: agendaOccurrenceCalendarUid(sessionId),
        organizerEmail,
        invitationSequence,
        partstat: "ACCEPTED",
        attendeeEmail: email,
        provider: "test-calendar",
        sourceMessageId: crypto.randomUUID(),
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      return app.fetch(
        new Request("http://local.test/api/v1/calendar/rsvp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-pkic-timestamp": timestamp,
            "x-pkic-signature": await hmacSha256Hex(secret, `${timestamp}.${body}`),
          },
          body,
        }),
        { ...env, RSVP_EMAIL: "rsvp@mail.pkic.org", INTERNAL_SIGNING_SECRET: secret } as Env,
        { passThroughOnException: () => {}, waitUntil: () => {} } as unknown as ExecutionContext,
      );
    };
    expect((await post(undefined)).status).toBe(401);
    const signedAddress = payload.__replyTo as string;
    const at = signedAddress.indexOf("@");
    const forged =
      signedAddress.slice(0, at - 1) + (signedAddress[at - 1] === "a" ? "b" : "a") + signedAddress.slice(at);
    expect((await post(forged)).status).toBe(401);
    expect((await post(oldPayload.__replyTo, 0)).status).toBe(404);
    expect(await status()).toBe("saved");
    expect((await post(signedAddress)).status).toBe(200);
    expect(await status()).toBe("reserved");
  });
  it("rolls back stale concurrent invitation issuance before dependent email and audit records", async () => {
    await invite();
    let raced = false;
    const db: DatabaseLike = {
      prepare: (q) => env.DB.prepare(q),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          await env.DB.prepare(
            "UPDATE agenda_session_invitations SET reply_sequence=reply_sequence+1 WHERE occurrence_id=? AND user_id=?",
          )
            .bind(sessionId, userId)
            .run();
        }
        return env.DB.batch(statements);
      },
    };
    const before = (await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM email_outbox WHERE template_key='agenda_session_invitation'",
    ).first<{ n: number }>())!.n;
    await expect(
      setSessionInvitation(
        db,
        eventId,
        sessionId,
        userId,
        { userId, attendanceMode: "physical", roomId, action: "invite", reasonCode: "organizer_invitation" },
        { secret },
      ),
    ).rejects.toMatchObject({ code: "SESSION_INVITATION_CONFLICT" });
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM email_outbox WHERE template_key='agenda_session_invitation'",
      ).first<{ n: number }>())!.n,
    ).toBe(before);
  });
  it("issues above an existing subscribed calendar sequence without changing the occurrence identity", async () => {
    const id = await invite();
    await env.DB.prepare(
      "UPDATE agenda_calendar_entries SET sequence=12 WHERE event_id=? AND occurrence_id=? AND user_id=?",
    )
      .bind(eventId, sessionId, userId)
      .run();
    await alterPublished("title", "Updated approved session title");
    const next = await invite();
    expect(invitationSequences.get(id)).toBe(0);
    expect(invitationSequences.get(next)).toBe(13);
    const payload = JSON.parse(
      (await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE idempotency_key=?")
        .bind(`agenda-invitation:${next}`)
        .first<{ payload_json: string }>())!.payload_json,
    );
    const entry = new ICAL.Component(ICAL.parse(payload.__calendarInvite.inlineContent)).getFirstSubcomponent(
      "vevent",
    )!;
    expect(entry.getFirstPropertyValue("uid")).toBe(agendaOccurrenceCalendarUid(sessionId));
    expect(entry.getFirstPropertyValue("sequence")).toBe(13);
    expect((await recordSessionInvitationRsvp(env.DB, reply(next)))?.disposition).toBe("applied");
  });
  it("parses sequence and records clock as claimed rather than trusted chronology", () => {
    const parsed = parseCalendarRsvp(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nSEQUENCE:0\r\nDTSTAMP:20261004T100000Z\r\nATTENDEE;PARTSTAT=ACCEPTED:mailto:person@example.test\r\nEND:VEVENT\r\nEND:VCALENDAR",
    );
    expect(parsed.invitationSequence).toBe(0);
    expect(parsed.claimedReplyAt).toBe("2026-10-04T10:00:00.000Z");
  });
});
