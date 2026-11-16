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
import {
  listUnfinishedRegistrationNotes,
  prepareRegistrationStart,
  readUnfinishedRegistrationSummary,
  sendUnfinishedRegistrationReminders,
} from "../functions/_lib/services/registrations/unfinished";

const BASE = "https://example.test";
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

let eventId: string;
let admin: Awaited<ReturnType<typeof seedEventAndAdmin>>["admin"];

beforeEach(async () => {
  await resetDb();
  ({ eventId, admin } = await seedEventAndAdmin(env.DB));
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
    "SELECT recipient_email, payload_json FROM email_outbox WHERE idempotency_key LIKE 'unfinished-registration:%' ORDER BY created_at",
  ).all<{ recipient_email: string; payload_json: string }>();

it("reminds after a day and after three days, then no more", async () => {
  await start("early@example.test", 2);
  const due = await start("due@example.test", 25);
  expect(await sendUnfinishedRegistrationReminders(env.DB, BASE)).toEqual({ reminded: 1, cleared: 0 });
  const sent = (await reminders()).results;
  expect(sent.map((row) => row.recipient_email)).toEqual(["due@example.test"]);
  expect(sent[0].payload_json).toContain("/not-registering");
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

it("sends nothing to a person who registered", async () => {
  const registered = await start("registered@example.test", 30);
  await createScheduledRegistration(env.DB, {
    event: { id: eventId },
    userId: registered.id,
    sourceType: "direct",
    mailboxVerified: true,
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
    mailboxVerified: true,
  });
  expect(await readUnfinishedRegistrationSummary(env.DB, { id: eventId })).toMatchObject({
    started: 1,
    registered: 1,
    stopped: 0,
    reasons: [],
    wroteNote: 0,
  });
});
