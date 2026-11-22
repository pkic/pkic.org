import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { createScheduledRegistration } from "./helpers/scheduled-registration";
import {
  ownUnfinishedRegistrationSchema,
  unfinishedRegistrationNoteListQuerySchema,
  unfinishedRegistrationNoteListSchema,
  unfinishedRegistrationSummarySchema,
} from "../assets/shared/schemas/unfinished-registrations";
import { findOrCreateUser } from "../functions/_lib/services/users";
import { nowIso } from "../functions/_lib/utils/time";
import { validateEmailDeliveryGuard } from "../functions/_lib/email/delivery-guard";
import { eventAudienceEvidenceById } from "../functions/_lib/services/events/visibility";
import { mutateBeforeMatchingQuery, mutateBeforeNextBatch } from "./helpers/database-races";
import {
  listUnfinishedRegistrationNotes,
  prepareRegistrationStart,
  startUnfinishedRegistration,
  readUnfinishedRegistrationSummary,
  sendUnfinishedRegistrationReminders,
  stopUnfinishedRegistration,
} from "../functions/_lib/services/registrations/unfinished";
import type { Env } from "../functions/_lib/types";

const BASE = "https://example.test";
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

let eventId: string;
let admin: Awaited<ReturnType<typeof seedEventAndAdmin>>["admin"];

beforeEach(async () => {
  await resetDb();
  ({ eventId, admin } = await seedEventAndAdmin(env.DB, { visibility: "public" }));
  await env.DB.batch([
    // The event is always ahead of the test's clock.
    env.DB.prepare("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?").bind(
      new Date(Date.now() + 90 * 24 * HOUR).toISOString(),
      new Date(Date.now() + 92 * 24 * HOUR).toISOString(),
      eventId,
    ),
  ]);
});

async function start(email: string, hoursAgo: number) {
  const user = await findOrCreateUser(env.DB, { email, firstName: "Synthetic", lastName: "Person" });
  await env.DB.batch([prepareRegistrationStart(env.DB, eventId, user.id, ago(hoursAgo))]);
  return user;
}

const reminders = () =>
  env.DB.prepare(
    "SELECT recipient_email, template_key, payload_json FROM email_outbox WHERE idempotency_key LIKE 'unfinished-registration:%' ORDER BY created_at",
  ).all<{ recipient_email: string; template_key: string; payload_json: string }>();

it("reminds after a day and after three days, then no more", async () => {
  await start("early@example.test", 2);
  const due = await start("due@example.test", 25);
  expect(await sendUnfinishedRegistrationReminders(env.DB, BASE)).toEqual({ reminded: 1, cleared: 0 });
  const sent = (await reminders()).results;
  expect(sent.map((row) => row.recipient_email)).toEqual(["due@example.test"]);
  expect(sent[0].payload_json).toContain("/not-registering");
  // The reminder is a stored template, so organizers can change its wording.
  expect(sent[0].template_key).toBe("registration_unfinished_reminder");
  expect(JSON.parse(sent[0].payload_json)).toMatchObject({
    eventName: expect.any(String),
    registerUrl: expect.any(String),
  });
  // The same run again sends nothing: the second reminder is due three days after the start.
  expect(await sendUnfinishedRegistrationReminders(env.DB, BASE)).toEqual({ reminded: 0, cleared: 0 });

  await env.DB.prepare("UPDATE unfinished_registrations SET started_at = ?, next_reminder_at = ? WHERE user_id = ?")
    .bind(ago(73), ago(1), due.id)
    .run();
  expect((await sendUnfinishedRegistrationReminders(env.DB, BASE)).reminded).toBe(1);
  const row = await env.DB.prepare(
    "SELECT reminders_sent, next_reminder_at FROM unfinished_registrations WHERE user_id = ?",
  )
    .bind(due.id)
    .first<{ reminders_sent: number; next_reminder_at: string | null }>();
  expect(row).toEqual({ reminders_sent: 2, next_reminder_at: null });
});

it("clears a reminder when the person's event access or account eligibility ends", async () => {
  await start("former-invitee@example.test", 25);
  const inactive = await start("inactive-reminder@example.test", 25);
  const inviteId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE events SET visibility = 'invitation_only' WHERE id = ?").bind(eventId),
    env.DB.prepare(
      `INSERT INTO invites (id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
       VALUES (?, ?, ?, 'attendee', ?, 'sent', 'direct', ?)`,
    ).bind(inviteId, eventId, "former-invitee@example.test", crypto.randomUUID(), nowIso()),
    env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(inactive.id),
  ]);
  await env.DB.prepare("UPDATE invites SET status = 'revoked' WHERE id = ?").bind(inviteId).run();

  expect(await sendUnfinishedRegistrationReminders(env.DB, BASE)).toEqual({ reminded: 0, cleared: 2 });
  expect((await reminders()).results).toEqual([]);
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM unfinished_registrations WHERE next_reminder_at IS NOT NULL",
    ).first(),
  ).toEqual({ n: 0 });
});

it("does not queue a reminder to the former address when the primary email changes before the write", async () => {
  const user = await start("former@example.test", 25);
  const racedDb = mutateBeforeNextBatch(env.DB, () =>
    env.DB.prepare("UPDATE users SET email = ?, normalized_email = ? WHERE id = ?")
      .bind("current@example.test", "current@example.test", user.id)
      .run(),
  );

  expect(await sendUnfinishedRegistrationReminders(racedDb, BASE)).toEqual({ reminded: 0, cleared: 1 });
  expect((await reminders()).results).toEqual([]);
});

it("makes a queued reminder undeliverable when its address stops being the primary email", async () => {
  const user = await start("former@example.test", 25);
  expect((await sendUnfinishedRegistrationReminders(env.DB, BASE)).reminded).toBe(1);
  const [reminder] = (await reminders()).results;
  const payload = JSON.parse(reminder.payload_json);
  await expect(validateEmailDeliveryGuard(env.DB, payload)).resolves.toBeUndefined();

  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET email = ?, normalized_email = ? WHERE id = ?").bind(
      "current@example.test",
      "current@example.test",
      user.id,
    ),
    // Retaining the former address as a verified alias must not authorize this primary-address reminder.
    env.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), user.id, "former@example.test", "former@example.test", now, now),
  ]);

  await expect(validateEmailDeliveryGuard(env.DB, payload)).rejects.toMatchObject({
    code: "CAPABILITY_RESOURCE_STALE",
  });
});

it("cancels a reminder awaiting retry when the person says they will not register", async () => {
  const user = await start("retrying@example.test", 25);
  expect((await sendUnfinishedRegistrationReminders(env.DB, BASE)).reminded).toBe(1);
  await env.DB.prepare("UPDATE email_outbox SET status = 'retrying' WHERE recipient_user_id = ?").bind(user.id).run();

  await stopUnfinishedRegistration(env.DB, { id: eventId }, user.id, {});

  const row = await env.DB.prepare("SELECT status FROM email_outbox WHERE recipient_user_id = ?")
    .bind(user.id)
    .first<{ status: string }>();
  expect(row?.status).toBe("cancelled");
});

it("rejects a reminder start when event access ends before its write", async () => {
  const user = await findOrCreateUser(env.DB, {
    email: "revoked-start@example.test",
    firstName: "Synthetic",
    lastName: "Person",
  });
  const audience = eventAudienceEvidenceById(eventId, { userId: user.id });
  const racedDb = mutateBeforeNextBatch(env.DB, () =>
    env.DB.prepare("UPDATE events SET visibility = 'invitation_only' WHERE id = ?").bind(eventId).run(),
  );
  await expect(
    startUnfinishedRegistration(racedDb, { id: eventId }, user.id, audience, {
      sql: "SELECT 1",
      bindings: [],
    }),
  ).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM unfinished_registrations").first()).toEqual({ n: 0 });
});

it("sends nothing to a person who registered", async () => {
  const registered = await start("registered@example.test", 30);
  await createScheduledRegistration(env.DB, {
    event: { id: eventId },
    userId: registered.id,
    sourceType: "direct",
    verifiedIdentity: { userId: registered.id },
  });
  expect(await sendUnfinishedRegistrationReminders(env.DB, BASE)).toEqual({ reminded: 0, cleared: 1 });

  expect((await reminders()).results).toHaveLength(0);
  // A person who is registered is not recorded as starting again.
  await env.DB.batch([prepareRegistrationStart(env.DB, eventId, registered.id, ago(0))]);
  expect((await readUnfinishedRegistrationSummary(env.DB, { id: eventId })).registered).toBe(1);
});

it("records a start from the form for an event without tickets", async () => {
  const user = await findOrCreateUser(env.DB, {
    email: "new@example.test",
    firstName: "Synthetic",
    lastName: "Person",
  });
  const token = await createMemberSession(env.DB, user.id, `session-${crypto.randomUUID()}`);
  const started = await callApi(env, "/api/v1/events/pqc-2026/registrations/unfinished", {
    method: "POST",
    body: "{}",
    headers: { cookie: `pkic_session=${token}`, "content-type": "application/json" },
  });
  expect(started.status).toBe(200);
  expect((await readUnfinishedRegistrationSummary(env.DB, { id: eventId })).started).toBe(1);
});

it("lets the person say they are not registering, which stops reminders and reaches the organizers", async () => {
  const user = await start("leaving@example.test", 30);
  const token = await createMemberSession(env.DB, user.id, `session-${crypto.randomUUID()}`);
  const authorized = { headers: { cookie: `pkic_session=${token}`, "content-type": "application/json" } };
  const path = "/api/v1/events/pqc-2026/registrations/unfinished";

  expect((await callApi(env, `${path}/current`)).status).toBe(401);
  // Starting again through the form's own route changes nothing: the first start stands.
  expect((await callApi(env, path, { method: "POST", body: "{}", ...authorized })).status).toBe(200);
  expect((await callApi(env, path, { method: "POST", body: "{}" })).status).toBe(401);
  const before = await callApi(env, `${path}/current`, authorized);
  expect(ownUnfinishedRegistrationSchema.parse(await before.json()).state).toBe("unfinished");

  const stopped = await callApi(env, `${path}/current/stop`, {
    method: "POST",
    body: JSON.stringify({ reasonCode: "price", reasonNote: "Our budget is frozen this year." }),
    ...authorized,
  });
  expect(stopped.status).toBe(200);
  const after = await callApi(env, `${path}/current`, authorized);
  expect(ownUnfinishedRegistrationSchema.parse(await after.json()).state).toBe("stopped");
  expect(await sendUnfinishedRegistrationReminders(env.DB, BASE)).toEqual({ reminded: 0, cleared: 0 });

  // The summary is the organizers': the person who stopped cannot read it.
  expect((await callApi(env, `${path}/summary`, authorized)).status).toBe(403);
  const summary = unfinishedRegistrationSummarySchema.parse(
    await readUnfinishedRegistrationSummary(env.DB, { id: eventId }),
  );
  expect(summary).toMatchObject({ started: 1, reminded: 0, stopped: 1, reasons: [{ reasonCode: "price", count: 1 }] });
  expect(summary.wroteNote).toBe(1);
  const notes = await listUnfinishedRegistrationNotes(
    env.DB,
    { id: eventId },
    unfinishedRegistrationNoteListQuerySchema.parse({ q: "budget" }),
  );
  expect(notes).toMatchObject({
    notes: [{ reasonCode: "price", note: "Our budget is frozen this year." }],
    page: { total: 1 },
  });
  expect((await callApi(env, `${path}/notes`, authorized)).status).toBe(403);
  // An organizer reads the notes through the mounted route, which also refuses a query outside its contract.
  const organizerToken = await createMemberSession(env.DB, admin.id, `session-${crypto.randomUUID()}`);
  const organizer = { headers: { cookie: `pkic_session=${organizerToken}` } };
  const listed = await callApi(env, `${path}/notes?limit=10&sort=-stoppedAt`, organizer);
  expect(listed.status).toBe(200);
  expect(unfinishedRegistrationNoteListSchema.parse(await listed.json())).toMatchObject({
    notes: [{ reasonCode: "price", note: "Our budget is frozen this year." }],
    page: { limit: 10, total: 1, hasMore: false },
  });
  expect((await callApi(env, `${path}/notes?sort=unknown`, organizer)).status).toBe(400);
  expect((await callApi(env, `${path}/notes?limit=101`, organizer)).status).toBe(400);

  // Saying no is not final: once they register after all, they count as registered, not as stopped.
  await createScheduledRegistration(env.DB, {
    event: { id: eventId },
    userId: user.id,
    sourceType: "direct",
    verifiedIdentity: { userId: user.id },
  });
  expect(await readUnfinishedRegistrationSummary(env.DB, { id: eventId })).toMatchObject({
    started: 1,
    registered: 1,
    stopped: 0,
    reasons: [],
    wroteNote: 0,
  });
});

it("keeps the unfinished registration and queued reminder when the session ends before stopping", async () => {
  const user = await start("revoked-stop@example.test", 30);
  const token = await createMemberSession(env.DB, user.id, `session-${crypto.randomUUID()}`);
  const reminderKey = `unfinished-registration:${eventId}:${user.id}:1`;
  expect((await sendUnfinishedRegistrationReminders(env.DB, BASE)).reminded).toBe(1);
  let revoked = false;
  const racedDb = mutateBeforeMatchingQuery(
    env.DB,
    (sql) => sql.includes("UPDATE unfinished_registrations") && sql.includes("SET stopped_at"),
    async () => {
      revoked = true;
      await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(nowIso(), user.id).run();
    },
  );
  const response = await callApi(
    { ...env, DB: racedDb } as Env,
    "/api/v1/events/pqc-2026/registrations/unfinished/current/stop",
    {
      method: "POST",
      body: JSON.stringify({ reasonCode: "price", reasonNote: "Our budget is frozen this year." }),
      headers: { cookie: `pkic_session=${token}`, "content-type": "application/json" },
    },
  );
  expect(revoked).toBe(true);
  expect(response.status).toBe(409);
  expect(
    await env.DB.prepare("SELECT stopped_at, stop_reason, stop_note FROM unfinished_registrations WHERE user_id = ?")
      .bind(user.id)
      .first(),
  ).toEqual({ stopped_at: null, stop_reason: null, stop_note: null });
  expect(
    await env.DB.prepare("SELECT status FROM email_outbox WHERE idempotency_key = ?").bind(reminderKey).first(),
  ).toEqual({
    status: "queued",
  });
});
