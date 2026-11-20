import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registrationCreateSchema, registrationSubmissionResponseSchema } from "../assets/shared/schemas/registration";
import { eventDetailResponseSchema, eventsListResponseSchema } from "../assets/shared/schemas/event-management";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import {
  registrationManagePageUrl,
  registrationPageUrl,
  registrationTokenManagePageUrl,
} from "../functions/_lib/services/frontend-links";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { createTestRateLimiter, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import type { Env } from "../functions/_lib/types";

let environment: Env;
const EVENT_PATH = "/api/v1/events/pqc-2026";

beforeEach(async () => {
  await resetDb();
  environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(3), IP_RATE_LIMITER: createTestRateLimiter(20) };
});

/** An invitation-only event with one attendee day and a signed-in person who represents one organization. */
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  // The event runs a month after the database clock, so the invitation's event window stays open.
  const dayDate = (await env.DB.prepare("SELECT date('now', '+30 days') AS day").first<{ day: string }>())!.day;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE events SET registration_mode = 'invitation_only', visibility = 'invitation_only',
         starts_at = ? || 'T08:00:00.000Z', ends_at = ? || 'T17:00:00.000Z' WHERE id = ?`,
    ).bind(dayDate, dayDate, eventId),
    env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,datetime('now'),datetime('now'))",
    ).bind(crypto.randomUUID(), eventId, dayDate),
  ]);
  const email = `invited-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET first_name = 'Invited', last_name = 'Attendee' WHERE id = ?")
    .bind(userId)
    .run();
  const identity = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId: await insertOrganization(env.DB, "Invited organization"),
    source: "staff",
    jobTitle: "Engineer",
    startImmediately: true,
  });
  await env.DB.batch([identity.statement]);
  const token = await createMemberSession(env.DB, userId, `held-invite-${crypto.randomUUID()}`);
  const body = registrationCreateSchema.parse({
    email,
    identityId: identity.identityId,
    dayAttendance: [{ dayDate, attendanceType: "virtual" }],
    sourceType: "direct",
    consents: [
      { termKey: "privacy-policy", version: "v1" },
      { termKey: "code-of-conduct", version: "v1" },
    ],
  });
  return { eventId, email, userId, token, body };
}

async function invite(eventId: string, email: string, overrides: { status?: string; expiresAt?: string } = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invites (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
     VALUES (?, ?, ?, 'attendee', ?, ?, 'direct', ?, datetime('now'))`,
  )
    .bind(id, eventId, email, `held-${id}`, overrides.status ?? "sent", overrides.expiresAt ?? null)
    .run();
  return id;
}

function call(path: string, token?: string, init: RequestInit = {}) {
  return callApi(environment, path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

function register(body: unknown, token: string) {
  return call(`${EVENT_PATH}/registrations`, token, { method: "POST", body: JSON.stringify(body) });
}

describe("registering with a held invitation", () => {
  it("admits the invited signed-in person without the link token and accepts the invitation in the same command", async () => {
    const f = await fixture();
    const inviteId = await invite(f.eventId, f.email);
    const response = await register(f.body, f.token);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = registrationSubmissionResponseSchema.parse(await response.json());
    expect(await queryAll(env.DB, "SELECT status FROM registrations WHERE id = ?", [result.registrationId])).toEqual([
      { status: "registered" },
    ]);
    expect(await queryAll(env.DB, "SELECT status FROM invites WHERE id = ?", [inviteId])).toEqual([
      { status: "accepted" },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM event_day_waitlist_entries")).toEqual([]);
  });

  it.each([
    ["no invitation", null],
    ["an expired invitation", { expiresAt: "2026-01-01T00:00:00.000Z" }],
    ["a revoked invitation", { status: "revoked" }],
    ["an invitation to another address", { email: "someone-else@example.test" }],
  ] as const)("refuses a person with %s", async (_, held) => {
    const f = await fixture();
    if (held) await invite(f.eventId, "email" in held ? held.email : f.email, "email" in held ? {} : held);
    const response = await register(f.body, f.token);
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "EVENT_REGISTRATION_ACCESS_REQUIRED" } });
    expect(await queryAll(env.DB, "SELECT id FROM registrations")).toEqual([]);
  });
});

describe("the invited reader's portal projections", () => {
  const listed = async (invitation: "open" | "none", token?: string) =>
    eventsListResponseSchema.parse(await (await call(`/api/v1/events?invitation=${invitation}`, token)).json());
  const upcoming = (token?: string) => listed("open", token);

  it("lists an open invitation apart from the other events until the person registers", async () => {
    const f = await fixture();
    const inviteId = await invite(f.eventId, f.email);
    const detail = eventDetailResponseSchema.parse(await (await call(EVENT_PATH, f.token)).json());
    expect(detail.event.participation?.registrationAccess).toBe("invitation");
    const invited = (await upcoming(f.token)).events;
    expect(invited.map((event) => event.slug)).toEqual(["pqc-2026"]);
    expect(invited[0].participation?.invitation).toEqual({ id: inviteId, remindersPausedUntil: null });
    expect((await listed("none", f.token)).events).toEqual([]);

    expect((await register(f.body, f.token)).status).toBe(200);
    expect((await upcoming(f.token)).events).toEqual([]);
    const registered = (await listed("none", f.token)).events;
    expect(registered.map((event) => event.slug)).toEqual(["pqc-2026"]);
    expect(registered[0].participation?.registrationStatus).toBe("registered");
    expect(registered[0].participation?.invitation ?? null).toBeNull();
  });

  it("lists an invitation sent to an address the person added to their account", async () => {
    const f = await fixture();
    const added = `added-${crypto.randomUUID()}@example.test`;
    await env.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(crypto.randomUUID(), f.userId, added, added)
      .run();
    const inviteId = await invite(f.eventId, added);
    const invited = (await upcoming(f.token)).events;
    expect(invited[0]?.participation?.invitation).toEqual({ id: inviteId, remindersPausedUntil: null });
  });

  it("offers nothing to a signed-in reader without an invitation", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE events SET visibility = 'public' WHERE id = ?").bind(f.eventId).run();
    const detail = eventDetailResponseSchema.parse(await (await call(EVENT_PATH, f.token)).json());
    expect(detail.event.participation?.registrationAccess ?? null).toBeNull();
    expect((await upcoming(f.token)).events).toEqual([]);
    expect((await upcoming()).events).toEqual([]);
    expect((await listed("none", f.token)).events.map((event) => event.slug)).toEqual(["pqc-2026"]);
    expect((await listed("none")).events.map((event) => event.slug)).toEqual(["pqc-2026"]);
  });

  it("carries the event's invitation wording, and falls back to none when unset", async () => {
    const f = await fixture();
    await invite(f.eventId, f.email);
    expect((await upcoming(f.token)).events[0].invitationMessage ?? null).toBeNull();
    const wording = { headline: "Join the PQC leaders", message: "Two days of **hands-on** sessions." };
    await env.DB.prepare("UPDATE events SET settings_json = ? WHERE id = ?")
      .bind(JSON.stringify({ invitationMessage: wording }), f.eventId)
      .run();
    expect((await upcoming(f.token)).events[0].invitationMessage).toEqual(wording);
  });
});

describe("answering an invitation while signed in", () => {
  const path = (inviteId: string, action: string) => `${EVENT_PATH}/invites/${inviteId}/${action}`;

  it("postpones reminders for a week, and the invitation stays open", async () => {
    const f = await fixture();
    const inviteId = await invite(f.eventId, f.email);
    const response = await call(path(inviteId, "reminders"), f.token, {
      method: "POST",
      body: JSON.stringify({ action: "postpone_7d" }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const [row] = await queryAll<{ status: string; reminders_paused_until: string | null }>(
      env.DB,
      "SELECT status, reminders_paused_until FROM invites WHERE id = ?",
      [inviteId],
    );
    expect(row.status).toBe("sent");
    expect(Date.parse(row.reminders_paused_until ?? "") - Date.now()).toBeGreaterThan(6 * 86_400_000);
  });

  it("declines with the survey answer through the same rule as the emailed link", async () => {
    const f = await fixture();
    const inviteId = await invite(f.eventId, f.email);
    const response = await call(path(inviteId, "decline"), f.token, {
      method: "POST",
      body: JSON.stringify({ reasonCode: "schedule_conflict", unsubscribeFuture: false }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT status, decline_reason_code FROM invites WHERE id = ?", [inviteId])).toEqual([
      { status: "declined", decline_reason_code: "schedule_conflict" },
    ]);
    expect((await call("/api/v1/events?invitation=open", f.token).then((r) => r.json())) as unknown).toMatchObject({
      events: [],
    });
  });

  it("refuses an invitation that belongs to another address, and an anonymous caller", async () => {
    const f = await fixture();
    const inviteId = await invite(f.eventId, "someone-else@example.test");
    const body = JSON.stringify({ reasonCode: "schedule_conflict" });
    expect((await call(path(inviteId, "decline"), f.token, { method: "POST", body })).status).toBe(404);
    expect((await call(path(inviteId, "decline"), undefined, { method: "POST", body })).status).toBe(401);
    expect(await queryAll(env.DB, "SELECT status FROM invites WHERE id = ?", [inviteId])).toEqual([{ status: "sent" }]);
  });
});

describe("registration form placements follow event visibility", () => {
  const PLACEMENT = `${EVENT_PATH}/forms/placements/event_registration`;

  it("hides an invitation-only event's forms from anonymous and uninvited readers", async () => {
    const f = await fixture();
    expect((await call(PLACEMENT)).status).toBe(404);
    expect((await call(PLACEMENT, f.token)).status).toBe(404);
    await invite(f.eventId, f.email);
    expect((await call(PLACEMENT, f.token)).status).toBe(200);
  });

  it("keeps a public event's forms readable without signing in", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE events SET visibility = 'public' WHERE id = ?").bind(f.eventId).run();
    expect((await call(PLACEMENT)).status).toBe(200);
  });
});

describe("registration links", () => {
  const event = {
    slug: "pqc-2026",
    base_path: "/events/2026/pqc/",
    starts_at: "2026-12-01T08:00:00.000Z",
    settings_json: "{}",
    source_mode: "portal",
  } as const;

  it("opens portal registration with the invitation attached for an event that is not public", () => {
    const url = new URL(
      registrationPageUrl(
        "https://pkic.example",
        { ...event, visibility: "invitation_only" },
        {
          invite: "token-value",
          inviteId: "invite-id",
          source: "invite",
        },
      ),
    );
    expect(url.pathname).toBe("/portal/");
    expect(url.hash).toBe("#/events/pqc-2026/register?invite=token-value&id=invite-id&source=invite");
  });

  it("keeps the public registration page for a public event", () => {
    const query = { invite: "token-value", inviteId: "invite-id", source: "invite" };
    const url = new URL(registrationPageUrl("https://pkic.example", { ...event, visibility: "public" }, query));
    expect(url.pathname.startsWith("/events/2026/pqc/")).toBe(true);
    expect(url.searchParams.get("invite")).toBe("token-value");
    expect(url.searchParams.get("id")).toBe("invite-id");
  });

  it("opens management of a registration for an event that is not public in the portal, without the token", () => {
    const url = new URL(
      registrationManagePageUrl(
        "https://pkic.example",
        { ...event, visibility: "invitation_only" },
        { token: "manage-token", registrationId: "registration-id" },
      ),
    );
    expect(url.pathname).toBe("/portal/");
    expect(url.hash).toBe("#/events/pqc-2026/registrations/registration-id");
    expect(url.toString()).not.toContain("manage-token");
  });

  it("keeps the token management page for a public event", () => {
    expect(
      registrationManagePageUrl(
        "https://pkic.example",
        { ...event, visibility: "public" },
        { token: "manage-token", registrationId: "registration-id" },
      ),
    ).toBe(registrationTokenManagePageUrl("https://pkic.example", event, "manage-token"));
  });
});
