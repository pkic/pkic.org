/** Canonical portal authentication and attendee access for event sponsors. */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { sponsorAttendeesListQuerySchema } from "../assets/shared/schemas/sponsor-access";
import { redeemSponsorSignInCapability } from "../functions/_lib/auth/user-session";
import {
  listSponsorAttendeesForExport,
  listSponsorAttendeesPageWithAudit,
  requireSponsorAttendeeAccess,
} from "../functions/_lib/services/sponsorship";
import { createAdminSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { resetDb } from "./helpers/reset-db";

function jsonRequest(path: string, body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`https://app.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function getRequest(path: string, token?: string): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`https://app.test${path}`, { headers });
}

async function call(request: Request): Promise<Response> {
  return app.fetch(request, env as never, { passThroughOnException: () => {}, waitUntil: () => {} } as never);
}

async function callAs(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return call(new Request(`https://app.test${path}`, { ...init, headers }));
}

function sessionTokenFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("pkic_session=");
  expect(cookie).not.toContain("pkic_sponsor_portal_session");
  return decodeURIComponent(cookie.split(";")[0].split("=")[1]);
}

async function readSponsorAccessToken(): Promise<string> {
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsor-portal-access' ORDER BY created_at DESC LIMIT 1",
  );
  const stored = JSON.parse(outbox.payload_json) as { portalUrl: string; __authorizedCapabilityMarkers?: unknown[] };
  expect(stored.portalUrl).toContain("/portal/#/verify?token=pkcq1_");
  expect(stored.__authorizedCapabilityMarkers).toHaveLength(1);
  const payload = await deliveredEmailPayload<{ portalUrl: string }>(env.DB, env, outbox.payload_json);
  const query = new URL(payload.portalUrl).hash.split("?", 2)[1] ?? "";
  return new URLSearchParams(query).get("token")!;
}

async function seedConsentingRegistration(eventId: string, email: string, term: string): Promise<string> {
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users
           (id, email, normalized_email, first_name, last_name, organization_name, job_title, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'Ada', 'Attendee', 'Attendee Org', 'Engineer', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email),
    env.DB.prepare(
      `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'registered', 'in_person', 'self', ?, datetime('now'), datetime('now'))`,
    ).bind(registrationId, eventId, userId, `manage-token-hash-${registrationId}`),
    env.DB.prepare(
      `INSERT INTO consent_acceptances
           (id, registration_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
         VALUES (?, ?, ?, ?, 'attendee', ?, 'v1', datetime('now'))`,
    ).bind(crypto.randomUUID(), registrationId, eventId, userId, term),
  ]);
  return registrationId;
}

describe("sponsor capacity in the canonical portal session", () => {
  let adminToken: string;
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const [admin] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    adminToken = await createAdminSession(env.DB, admin.id, `sponsor-admin-${crypto.randomUUID()}`);
    const tiers = await callAs(adminToken, "/api/v1/events/pqc-2026/sponsors/tiers", {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
    });
    expect(tiers.status).toBe(200);
  });

  async function createActiveEventSponsor(tier: string, contactEmail: string): Promise<string> {
    const createdResponse = await callAs(adminToken, "/api/v1/sponsors", {
      method: "POST",
      body: JSON.stringify({
        sponsorType: "event",
        eventId,
        tier,
        contactEmail,
        contactName: "Sponsor Contact",
        renewalDate: new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10),
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { sponsorship: { id: string } };
    const activated = await callAs(adminToken, `/api/v1/sponsors/${created.sponsorship.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active" }),
    });
    expect(activated.status).toBe(200);
    return created.sponsorship.id;
  }

  async function createSponsorUserSession(email: string): Promise<string> {
    let [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", email);
    if (!user) {
      const userId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
           VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
      )
        .bind(userId, email, email)
        .run();
      user = { id: userId };
    }
    return createAdminSession(env.DB, user.id, `sponsor-user-${crypto.randomUUID()}`);
  }

  it("redeems a sponsor access link into pkic_session and lists only consenting attendees", async () => {
    const sponsorId = await createActiveEventSponsor("Leader", "leader@sponsor.test");
    await seedConsentingRegistration(eventId, "yes@attendee.test", "sponsor-data-sharing");
    await seedConsentingRegistration(eventId, "no@attendee.test", "privacy-policy");

    const requested = await call(
      jsonRequest("/api/v1/sponsors/access-links", { email: "leader@sponsor.test", eventSlug: "pqc-2026" }),
    );
    expect(requested.status).toBe(200);
    const verified = await call(jsonRequest("/api/v1/auth/verify-link", { token: await readSponsorAccessToken() }));
    expect(verified.status).toBe(200);
    const body = (await verified.json()) as {
      identity: { email: string };
      sponsors: Array<{ sponsorId: string; eventId: string; eventSlug: string; tier: string }>;
    };
    expect(body.identity.email).toBe("leader@sponsor.test");
    expect(body.sponsors).toEqual([
      expect.objectContaining({ sponsorId, eventId, eventSlug: "pqc-2026", tier: "Leader" }),
    ]);
    const sessionToken = sessionTokenFrom(verified);

    const session = await call(getRequest("/api/v1/auth/session", sessionToken));
    await expect(session.json()).resolves.toMatchObject({ sponsors: [{ sponsorId }] });
    const attendees = await call(getRequest(`/api/v1/sponsors/${sponsorId}/events/${eventId}/attendees`, sessionToken));
    expect(attendees.status).toBe(200);
    const attendeeBody = (await attendees.json()) as { attendees: Array<{ email: string }> };
    expect(attendeeBody.attendees.map((attendee) => attendee.email)).toEqual(["yes@attendee.test"]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = 'leader@sponsor.test'")).toHaveLength(
      1,
    );
    expect(
      await queryAll(
        env.DB,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sponsor_portal_sessions'",
      ),
    ).toHaveLength(0);
  });

  it("paginates the attendee list in D1", async () => {
    const sponsorId = await createActiveEventSponsor("Leader", "paged@sponsor.test");
    await Promise.all(
      ["a1@attendee.test", "a2@attendee.test", "a3@attendee.test"].map((email) =>
        seedConsentingRegistration(eventId, email, "sponsor-data-sharing"),
      ),
    );
    const token = await createSponsorUserSession("paged@sponsor.test");
    const first = await call(
      getRequest(`/api/v1/sponsors/${sponsorId}/events/${eventId}/attendees?limit=2&offset=0`, token),
    );
    const firstBody = (await first.json()) as { attendees: unknown[]; page: { total: number; hasMore: boolean } };
    expect(firstBody.attendees).toHaveLength(2);
    expect(firstBody.page).toMatchObject({ total: 3, hasMore: true });
    const second = await call(
      getRequest(`/api/v1/sponsors/${sponsorId}/events/${eventId}/attendees?limit=2&offset=2`, token),
    );
    const secondBody = (await second.json()) as { attendees: unknown[]; page: { hasMore: boolean } };
    expect(secondBody.attendees).toHaveLength(1);
    expect(secondBody.page.hasMore).toBe(false);
  });

  it("deduplicates repeated consent versions and bounds CSV export", async () => {
    await createActiveEventSponsor("Leader", "consent@sponsor.test");
    const registrationId = await seedConsentingRegistration(
      eventId,
      "consent-history@attendee.test",
      "sponsor-data-sharing",
    );
    const [{ user_id: userId }] = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM registrations WHERE id = ?",
      registrationId,
    );
    await env.DB.prepare(
      `INSERT INTO consent_acceptances
           (id, registration_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
         VALUES (?, ?, ?, ?, 'attendee', 'sponsor-data-sharing', 'v2', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), registrationId, eventId, userId)
      .run();
    expect(await listSponsorAttendeesForExport(env.DB, eventId, 10)).toHaveLength(1);
    await seedConsentingRegistration(eventId, "second@attendee.test", "sponsor-data-sharing");
    await expect(listSponsorAttendeesForExport(env.DB, eventId, 1)).rejects.toMatchObject({
      status: 413,
      code: "CSV_EXPORT_ROW_LIMIT_EXCEEDED",
    });
  });

  it("rechecks tier, stage, and contact email against live D1 state", async () => {
    const ineligibleId = await createActiveEventSponsor("Ambassador", "ambassador@sponsor.test");
    const ineligibleToken = await createSponsorUserSession("ambassador@sponsor.test");
    expect(
      await call(getRequest(`/api/v1/sponsors/${ineligibleId}/events/${eventId}/attendees`, ineligibleToken)),
    ).toMatchObject({ status: 403 });

    const sponsorId = await createActiveEventSponsor("Leader", "live@sponsor.test");
    const token = await createSponsorUserSession("live@sponsor.test");
    await env.DB.prepare("UPDATE sponsorships SET contact_email = ?, updated_at = datetime('now') WHERE id = ?")
      .bind("replacement@sponsor.test", sponsorId)
      .run();
    expect(await call(getRequest(`/api/v1/auth/session`, token))).toMatchObject({ status: 401 });

    const replacementToken = await createSponsorUserSession("replacement@sponsor.test");
    await callAs(adminToken, `/api/v1/sponsors/${sponsorId}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "lapsed" }),
    });
    expect(await call(getRequest(`/api/v1/auth/session`, replacementToken))).toMatchObject({ status: 401 });
  });

  it("rolls back sponsor redemption if the contact changes before its D1 batch", async () => {
    const sponsorId = await createActiveEventSponsor("Leader", "race@sponsor.test");
    const token = await readSponsorAccessToken();
    const gate = gateNextBatch(env.DB);
    const stale = redeemSponsorSignInCapability(gate.db, {
      token,
      signingSecret: env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret",
      sessionTtlHours: 8,
    });
    await gate.reached;
    await env.DB.prepare("UPDATE sponsorships SET contact_email = ?, updated_at = datetime('now') WHERE id = ?")
      .bind("changed@sponsor.test", sponsorId)
      .run();
    gate.release();
    await expect(stale).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)",
        "race@sponsor.test",
      ),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'sponsor_magic_link_verified'"),
    ).toHaveLength(0);
  });

  it("does not disclose attendees when sponsor capacity changes before the read batch", async () => {
    const sponsorId = await createActiveEventSponsor("Leader", "read-race@sponsor.test");
    await seedConsentingRegistration(eventId, "race-attendee@attendee.test", "sponsor-data-sharing");
    await createSponsorUserSession("read-race@sponsor.test");
    const [user] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE normalized_email = 'read-race@sponsor.test'",
    );
    const capacity = await requireSponsorAttendeeAccess(env.DB, user.id, sponsorId, eventId);
    const gate = gateNextBatch(env.DB);
    const staleRead = listSponsorAttendeesPageWithAudit(
      gate.db,
      user.id,
      capacity,
      sponsorAttendeesListQuerySchema.parse({}),
    );
    await gate.reached;
    await env.DB.prepare("UPDATE sponsorships SET contact_email = ?, updated_at = datetime('now') WHERE id = ?")
      .bind("replacement-read-race@sponsor.test", sponsorId)
      .run();
    gate.release();
    await expect(staleRead).rejects.toMatchObject({ status: 403, code: "SPONSOR_ACCESS_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'sponsor_attendee_list_viewed'"),
    ).toHaveLength(0);
  });

  it("exports CSV through the collection representation and logs the authenticated user", async () => {
    const sponsorId = await createActiveEventSponsor("Leader", "csv@sponsor.test");
    await seedConsentingRegistration(eventId, "shared@attendee.test", "sponsor-data-sharing");
    const token = await createSponsorUserSession("csv@sponsor.test");
    const response = await call(
      getRequest(`/api/v1/sponsors/${sponsorId}/events/${eventId}/attendees?format=csv`, token),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(await response.text()).toContain("shared@attendee.test");
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'sponsor_attendee_export'")).toHaveLength(1);
  });

  it("logs out through canonical auth and revokes the one user session", async () => {
    await createActiveEventSponsor("Leader", "logout@sponsor.test");
    const requested = await call(
      jsonRequest("/api/v1/sponsors/access-links", { email: "logout@sponsor.test", eventSlug: "pqc-2026" }),
    );
    expect(requested.status).toBe(200);
    const verified = await call(jsonRequest("/api/v1/auth/verify-link", { token: await readSponsorAccessToken() }));
    const token = sessionTokenFrom(verified);
    const logout = await call(
      new Request("https://app.test/api/v1/auth/logout", {
        method: "POST",
        headers: { cookie: `pkic_session=${encodeURIComponent(token)}` },
      }),
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await call(getRequest("/api/v1/auth/session", token))).toMatchObject({ status: 401 });
  });
});
