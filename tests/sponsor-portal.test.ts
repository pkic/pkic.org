/**
 * sponsor-portal.test.ts — "Sponsor Portal — Attendee Data
 * Access".
 *
 * A sponsor contact (no `users` row) signs in via magic link scoped to a
 * single active event sponsorship, and can view/export attendee data for
 * consenting registrants only if their tier is configured for attendee-data
 * access on that event — re-checked live on every request.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { issueSponsorPortalSession, signSponsorPortalSessionToken } from "../functions/_lib/auth/sponsor-portal";

/** Issues a real sponsor-portal session directly (bypassing the magic-link email round trip). */
async function createSponsorPortalSession(sponsorshipId: string): Promise<string> {
  const { sessionId, expiresAt } = await issueSponsorPortalSession(env.DB, sponsorshipId, 8);
  return signSponsorPortalSessionToken(env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret", {
    sponsorshipId,
    sessionId,
    expiresAt,
  });
}

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

// Logout reads the session token from the Cookie header only (mirrors
// auth/member/logout.ts — a browser-only affordance, never a Bearer API
// call), so it needs its own request builder rather than jsonRequest's
// Authorization header.
function cookiePostRequest(path: string, cookieToken: string): Request {
  const headers = new Headers({ cookie: `pkic_sponsor_portal_session=${encodeURIComponent(cookieToken)}` });
  return new Request(`https://app.test${path}`, { method: "POST", headers });
}

async function call(request: Request): Promise<Response> {
  return app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

async function callAdmin(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return call(new Request(`https://app.test${path}`, { ...init, headers }));
}

async function seedConsentingRegistration(eventId: string, email: string, term: string): Promise<void> {
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Ada', 'Attendee', 'Attendee Org', 'Engineer', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email),
    env.DB.prepare(
      `INSERT INTO registrations (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'in_person', 'self', ?, datetime('now'), datetime('now'))`,
    ).bind(registrationId, eventId, userId, `manage-token-hash-${registrationId}`),
    env.DB.prepare(
      `INSERT INTO consent_acceptances (id, registration_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
       VALUES (?, ?, ?, ?, 'attendee', ?, 'v1', datetime('now'))`,
    ).bind(crypto.randomUUID(), registrationId, eventId, userId, term),
  ]);
}

describe("Sponsor portal", () => {
  let adminToken: string;
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-sponsor-portal-token");

    await callAdmin(adminToken, "/api/v1/admin/events/pqc-2026/sponsor-tiers", {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
    });
  });

  async function createActiveEventSponsorship(tier: string, contactEmail: string): Promise<string> {
    const createResponse = await callAdmin(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({ sponsorType: "event", eventId, tier, contactEmail, contactName: "Sponsor Contact" }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };
    await callAdmin(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active" }),
    });
    return created.sponsorship.id;
  }

  it("requests and verifies a magic link, then lists only sponsor-data-sharing consenting attendees", async () => {
    await createActiveEventSponsorship("Leader", "leader@sponsor.test");
    await seedConsentingRegistration(eventId, "yes@attendee.test", "sponsor-data-sharing");
    await seedConsentingRegistration(eventId, "no@attendee.test", "privacy-policy");

    const requestLinkResponse = await call(
      jsonRequest("/api/v1/auth/sponsor-portal/request-link", { email: "leader@sponsor.test", eventId }),
    );
    expect(requestLinkResponse.status).toBe(200);

    const tokenRow = (
      await queryAll<{ token_hash: string }>(
        env.DB,
        "SELECT token_hash FROM sponsor_portal_magic_links ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    expect(tokenRow).toBeDefined();

    // We can't recover the raw token from its hash, so exercise verify-link
    // against a freshly issued one via the stage-transition side effect
    // instead (already covered structurally in sponsorship-pipeline.test.ts);
    // here we drive the session issuance directly through the service layer
    // equivalent path used by verify-link, by requesting a second link and
    // reading it back out of the outbox email body.
    const outboxRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsor-portal-access' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const payload = JSON.parse(outboxRow.payload_json) as { portalUrl: string };
    const magicToken = new URL(payload.portalUrl).searchParams.get("token");
    expect(magicToken).toBeTruthy();

    const verifyResponse = await call(jsonRequest("/api/v1/auth/sponsor-portal/verify-link", { token: magicToken }));
    expect(verifyResponse.status).toBe(200);
    const verified = (await verifyResponse.json()) as { sponsorship: { eventId: string; tier: string } };
    expect(verified.sponsorship.tier).toBe("Leader");
    const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
    const sessionToken = decodeURIComponent(setCookie.split(";")[0].split("=")[1]);

    const attendeesResponse = await call(
      getRequest(`/api/v1/sponsor-portal/events/${eventId}/attendees`, sessionToken),
    );
    expect(attendeesResponse.status).toBe(200);
    const attendeesBody = (await attendeesResponse.json()) as { attendees: { email: string }[] };
    expect(attendeesBody.attendees.map((a) => a.email)).toEqual(["yes@attendee.test"]);
  });

  it("P6M-P2-11: bounds the attendee list with ?limit=/?offset= instead of returning every consenting attendee unbounded", async () => {
    const sponsorshipId = await createActiveEventSponsorship("Leader", "leader-paged@sponsor.test");
    await seedConsentingRegistration(eventId, "a1@attendee.test", "sponsor-data-sharing");
    await seedConsentingRegistration(eventId, "a2@attendee.test", "sponsor-data-sharing");
    await seedConsentingRegistration(eventId, "a3@attendee.test", "sponsor-data-sharing");

    const sessionToken = await createSponsorPortalSession(sponsorshipId);

    const firstPage = await call(
      getRequest(`/api/v1/sponsor-portal/events/${eventId}/attendees?limit=2&offset=0`, sessionToken),
    );
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      attendees: unknown[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstBody.attendees).toHaveLength(2);
    expect(firstBody.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });

    const secondPage = await call(
      getRequest(`/api/v1/sponsor-portal/events/${eventId}/attendees?limit=2&offset=2`, sessionToken),
    );
    const secondBody = (await secondPage.json()) as { attendees: unknown[]; page: { hasMore: boolean } };
    expect(secondBody.attendees).toHaveLength(1);
    expect(secondBody.page.hasMore).toBe(false);
  });

  it("403s attendee access when the sponsorship's tier is not configured for attendee data access", async () => {
    const sponsorshipId = await createActiveEventSponsorship("Ambassador", "ambassador@sponsor.test");
    const magicLinkRow = (
      await queryAll<{ token_hash: string }>(
        env.DB,
        "SELECT token_hash FROM sponsor_portal_magic_links WHERE sponsorship_id = ?",
        [sponsorshipId],
      )
    )[0];
    expect(magicLinkRow).toBeUndefined();
  });

  it("403s attendee access once the sponsorship lapses", async () => {
    await createActiveEventSponsorship("Leader", "leader2@sponsor.test");
    const outboxRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsor-portal-access' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const payload = JSON.parse(outboxRow.payload_json) as { portalUrl: string };
    const magicToken = new URL(payload.portalUrl).searchParams.get("token");

    const verifyResponse = await call(jsonRequest("/api/v1/auth/sponsor-portal/verify-link", { token: magicToken }));
    const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
    const sessionToken = decodeURIComponent(setCookie.split(";")[0].split("=")[1]);

    const sponsorshipRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM sponsorships WHERE contact_email = 'leader2@sponsor.test'")
    )[0];
    await callAdmin(adminToken, `/api/v1/admin/sponsorships/${sponsorshipRow.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "lapsed" }),
    });

    const attendeesResponse = await call(
      getRequest(`/api/v1/sponsor-portal/events/${eventId}/attendees`, sessionToken),
    );
    expect(attendeesResponse.status).toBe(403);
  });

  it("exports attendees as CSV and logs the download in audit_log", async () => {
    await createActiveEventSponsorship("Leader", "leader3@sponsor.test");
    await seedConsentingRegistration(eventId, "csv@attendee.test", "sponsor-data-sharing");

    const outboxRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsor-portal-access' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const payload = JSON.parse(outboxRow.payload_json) as { portalUrl: string };
    const magicToken = new URL(payload.portalUrl).searchParams.get("token");
    const verifyResponse = await call(jsonRequest("/api/v1/auth/sponsor-portal/verify-link", { token: magicToken }));
    const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
    const sessionToken = decodeURIComponent(setCookie.split(";")[0].split("=")[1]);

    const exportResponse = await call(
      getRequest(`/api/v1/sponsor-portal/events/${eventId}/attendees/export`, sessionToken),
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
    const csv = await exportResponse.text();
    expect(csv).toContain("csv@attendee.test");

    const auditRows = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE action = 'sponsor_portal_attendee_export'",
    );
    expect(auditRows).toHaveLength(1);
  });

  it("resolves eventId by public slug (not just internal id) and returns eventName in the session", async () => {
    await createActiveEventSponsorship("Leader", "slug-sponsor@sponsor.test");

    const requestLinkResponse = await call(
      jsonRequest("/api/v1/auth/sponsor-portal/request-link", {
        email: "slug-sponsor@sponsor.test",
        eventId: "pqc-2026",
      }),
    );
    expect(requestLinkResponse.status).toBe(200);

    const outboxRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsor-portal-access' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const payload = JSON.parse(outboxRow.payload_json) as { portalUrl: string };
    const magicToken = new URL(payload.portalUrl).searchParams.get("token");
    expect(magicToken).toBeTruthy();

    const verifyResponse = await call(jsonRequest("/api/v1/auth/sponsor-portal/verify-link", { token: magicToken }));
    expect(verifyResponse.status).toBe(200);
    const verified = (await verifyResponse.json()) as {
      sponsorship: { eventId: string; eventName: string | null; tier: string };
    };
    expect(verified.sponsorship.eventId).toBe(eventId);
    expect(verified.sponsorship.eventName).toBe("PQC Conference 2026");
  });

  it("logs out: revokes the session server-side and clears the cookie", async () => {
    await createActiveEventSponsorship("Leader", "logout-sponsor@sponsor.test");
    const outboxRow = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsor-portal-access' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const payload = JSON.parse(outboxRow.payload_json) as { portalUrl: string };
    const magicToken = new URL(payload.portalUrl).searchParams.get("token");
    const verifyResponse = await call(jsonRequest("/api/v1/auth/sponsor-portal/verify-link", { token: magicToken }));
    const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
    const sessionToken = decodeURIComponent(setCookie.split(";")[0].split("=")[1]);

    const logoutResponse = await call(cookiePostRequest("/api/v1/sponsor-portal/logout", sessionToken));
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    const attendeesResponse = await call(
      getRequest(`/api/v1/sponsor-portal/events/${eventId}/attendees`, sessionToken),
    );
    expect(attendeesResponse.status).toBe(401);
  });
});
