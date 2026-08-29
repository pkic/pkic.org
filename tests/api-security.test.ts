/**
 * api-security.test.ts
 *
 * Integration-level security test that verifies:
 *
 *  1. Every protected admin / internal endpoint enforces authentication and
 *     rejects unauthenticated requests with AUTH_REQUIRED.
 *
 *  2. The session-token validation logic handles all invalid-credential
 *     scenarios (garbage token, expired session, revoked session, non-admin
 *     user, inactive admin user) and also accepts the ADMIN_API_KEY shortcut.
 *
 *  3. Endpoints reject unsupported HTTP methods with 405.
 *
 *  4. Public endpoints remain accessible without any credentials.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { SELF, env } from "cloudflare:test";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { PERMISSION_DENIED_MESSAGE } from "../assets/shared/auth-errors";
import { signUserSessionToken } from "../functions/_lib/auth/user-session";
import { signMcpSessionToken } from "../functions/_lib/auth/mcp-session";
import type { AuthScope } from "../functions/_lib/auth/scopes";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { nowIso } from "../functions/_lib/utils/time";
import { signJwt } from "../functions/_lib/utils/jwt";
import type { DatabaseLike, Env as AppEnv } from "../functions/_lib/types";

// ── Public endpoint handlers ──────────────────────────────────────────────────
import { onRequestGet as eventTermsGet } from "../functions/api/v1/events/[eventSlug]/terms";
import { onRequest as geolocationCountryRequest } from "../functions/api/v1/geolocation/country";
import { geolocationCountryResponseSchema } from "../assets/shared/schemas/geolocation";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Makes a GET request with no Authorization header. */
function anonGet(url: string): Request {
  return new Request(url);
}

/** Makes a POST request with no Authorization header. */
function anonPost(url: string): Request {
  return new Request(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
}

function anonPostBody(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Makes a GET request with a Bearer token. */
function bearerGet(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

function mcpBearerGet(url: string, token: string): Request {
  return new Request(url, {
    headers: { authorization: `Bearer ${token}`, "x-pkic-machine-auth": "mcp" },
  });
}

/** Makes a PATCH request with no Authorization header. */
function anonPatch(url: string, body: unknown = {}): Request {
  return new Request(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Makes a DELETE request with no Authorization header. */
function anonDelete(url: string): Request {
  return new Request(url, { method: "DELETE" });
}

function callApp(request: Request): Promise<Response> {
  return SELF.fetch(request);
}

const appEnv = env as unknown as AppEnv;

/** Inserts a session directly, allowing control over expires_at and revoked_at. */
async function insertSession(
  _db: DatabaseLike,
  userId: string,
  rawToken: string,
  opts: { expiresAt?: string; revokedAt?: string; scopes?: AuthScope[] } = {},
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  const revokedAt = opts.revokedAt ?? null;
  await env.DB.prepare(
    `
    INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
    VALUES ('${sessionId}', '${userId}', '${tokenHash}',
            '${expiresAt}', ${revokedAt ? `'${revokedAt}'` : "NULL"}, '${nowIso()}');
  `,
  ).run();

  if (opts.scopes) {
    return signMcpSessionToken(env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret", {
      sub: userId,
      sid: sessionId,
      email: "admin@example.test",
      role: "admin",
      scopes: opts.scopes,
      exp: Math.floor(new Date(expiresAt).getTime() / 1000),
    });
  }
  return signUserSessionToken(env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret", {
    sub: userId,
    sid: sessionId,
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Admin / internal endpoint — auth enforcement (no Authorization header)
// ─────────────────────────────────────────────────────────────────────────────

describe("protected endpoint — rejects unauthenticated requests", () => {
  beforeEach(async () => {
    await resetDb();
  });
  let eventSlug: string;
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const permId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const grantId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const userRoleId = crypto.randomUUID();
  const passkeyId = crypto.randomUUID();
  const formKey = "test-form";
  const templateKey = "transactional";
  const reviewId = crypto.randomUUID();

  beforeEach(async () => {
    await seedEventAndAdmin(env.DB);
    eventSlug = "pqc-2026";
  });

  // Each entry: [description, thunk that invokes the real router with no auth]
  const cases: [string, () => Promise<Response>][] = [
    ["GET /api/v1/users", () => callApp(anonGet("https://app.test/api/v1/users"))],
    ["GET /api/v1/analytics/summary", () => callApp(anonGet("https://app.test/api/v1/analytics/summary"))],
    [
      "GET /api/v1/leadership/positions",
      () => callApp(anonGet("https://app.test/api/v1/leadership/positions?body=board")),
    ],
    ["GET /api/v1/donations", () => callApp(anonGet("https://app.test/api/v1/donations"))],
    ["GET /api/v1/audit-log", () => callApp(anonGet("https://app.test/api/v1/audit-log"))],
    ["GET /api/v1/membership/settings", () => callApp(anonGet("https://app.test/api/v1/membership/settings"))],
    ["GET /api/v1/membership/categories", () => callApp(anonGet("https://app.test/api/v1/membership/categories"))],
    [
      "GET /api/v1/organizations/content-reviews",
      () => callApp(anonGet("https://app.test/api/v1/organizations/content-reviews")),
    ],
    ["GET /api/v1/email/templates", () => callApp(anonGet("https://app.test/api/v1/email/templates"))],
    [
      "GET /api/v1/events/:slug/registrations",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/registrations`)),
    ],
    ["GET /api/v1/events/:slug/forms", () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/forms`))],
    ["GET /api/v1/users/:id", () => callApp(anonGet(`https://app.test/api/v1/users/${userId}`))],
    ["POST /api/v1/email/outbox/process", () => callApp(anonPost("https://app.test/api/v1/email/outbox/process"))],
    [
      "POST /api/v1/operations/reminders/run",
      () => callApp(anonPost("https://app.test/api/v1/operations/reminders/run")),
    ],
    [
      "POST /api/v1/operations/retention/run",
      () => callApp(anonPost("https://app.test/api/v1/operations/retention/run")),
    ],
    [
      "POST /api/v1/email/outbox/reset-failed",
      () => callApp(anonPostBody("https://app.test/api/v1/email/outbox/reset-failed", { ids: [crypto.randomUUID()] })),
    ],
    // ── Additional admin endpoints ──────────────────────────────────────────
    ["POST /api/v1/donations/sync", () => callApp(anonPost("https://app.test/api/v1/donations/sync"))],
    [
      "POST /api/v1/email/templates/preview",
      () => callApp(anonPostBody("https://app.test/api/v1/email/templates/preview", { content: "preview" })),
    ],
    [
      "POST /api/v1/email/templates/:key/activate",
      () => callApp(anonPostBody(`https://app.test/api/v1/email/templates/${templateKey}/activate`, { version: 1 })),
    ],
    [
      "POST /api/v1/email/templates/:key/versions",
      () =>
        callApp(
          anonPostBody(`https://app.test/api/v1/email/templates/${templateKey}/versions`, {
            content: "version",
          }),
        ),
    ],
    ["GET /api/v1/forms/:formKey", () => callApp(anonGet(`https://app.test/api/v1/forms/${formKey}`))],
    ["PATCH /api/v1/forms/:formKey", () => callApp(anonPatch(`https://app.test/api/v1/forms/${formKey}`))],
    ["DELETE /api/v1/forms/:formKey", () => callApp(anonDelete(`https://app.test/api/v1/forms/${formKey}`))],
    [
      "GET /api/v1/forms/:formKey/submissions",
      () => callApp(anonGet(`https://app.test/api/v1/forms/${formKey}/submissions`)),
    ],
    [
      "PATCH /api/v1/users/:userId (global role)",
      () => callApp(anonPatch(`https://app.test/api/v1/users/${userId}`, { role: "user" })),
    ],
    [
      "PATCH /api/v1/users/:userId (detail+role)",
      () => callApp(anonPatch(`https://app.test/api/v1/users/${userId}`, { firstName: "Unauthenticated" })),
    ],
    [
      "POST /api/v1/users/:userId/anonymize",
      () => callApp(anonPost(`https://app.test/api/v1/users/${userId}/anonymize`)),
    ],
    [
      "POST /api/v1/users/:userId/gravatar",
      () => callApp(anonPost(`https://app.test/api/v1/users/${userId}/gravatar`)),
    ],
    ["* /api/v1/users/:userId/headshot", () => callApp(anonGet(`https://app.test/api/v1/users/${userId}/headshot`))],
    [
      "POST /api/v1/events/imports",
      () =>
        callApp(
          anonPostBody("https://app.test/api/v1/events/imports", {
            source: "hugo",
            event: { slug: "anon-import", name: "Anon import", timezone: "UTC", visibility: "invitation_only" },
          }),
        ),
    ],
    ["GET /api/v1/events/:slug/days", () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/days`))],
    ["POST /api/v1/events/:slug/forms", () => callApp(anonPost(`https://app.test/api/v1/events/${eventSlug}/forms`))],
    [
      "PATCH /api/v1/events/:slug/settings",
      () => callApp(anonPatch(`https://app.test/api/v1/events/${eventSlug}/settings`)),
    ],
    ["GET /api/v1/events/:slug/roles", () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/roles`))],
    ["POST /api/v1/events/:slug/roles", () => callApp(anonPost(`https://app.test/api/v1/events/${eventSlug}/roles`))],
    [
      "DELETE /api/v1/events/:slug/roles/:roleAssignmentId",
      () => callApp(anonDelete(`https://app.test/api/v1/events/${eventSlug}/roles/${permId}`)),
    ],
    [
      "GET /api/v1/events/:slug/promoters",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/promoters`)),
    ],
    [
      "GET /api/v1/events/:slug/analytics",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/analytics`)),
    ],
    [
      "GET /api/v1/events/:slug/presentations/archive",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/presentations/archive`)),
    ],
    [
      "GET /api/v1/events/:slug/proposals",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/proposals`)),
    ],
    [
      "POST /api/v1/events/:slug/email/campaigns/previews",
      () => callApp(anonPost(`https://app.test/api/v1/events/${eventSlug}/email/campaigns/previews`)),
    ],
    [
      "POST /api/v1/events/:slug/email/campaigns",
      () => callApp(anonPost(`https://app.test/api/v1/events/${eventSlug}/email/campaigns`)),
    ],
    [
      "POST /api/v1/events/:slug/registrations/:registrationId/admissions",
      () =>
        callApp(
          anonPostBody(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}/admissions`, {
            mode: "vip",
            reason: "Authentication boundary test",
            dayDates: ["2026-12-01"],
          }),
        ),
    ],
    [
      "GET /api/v1/events/:slug/registrations/:registrationId/badge",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}/badge`)),
    ],
    [
      "POST /api/v1/events/:slug/registrations/promotions",
      () => callApp(anonPost(`https://app.test/api/v1/events/${eventSlug}/registrations/promotions`)),
    ],
    [
      "GET /api/v1/events/:slug/registrations/:registrationId",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}`)),
    ],
    [
      "PATCH /api/v1/events/:slug/registrations/:registrationId",
      () =>
        callApp(
          anonPatch(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}`, {
            action: "update",
            attendanceType: "virtual",
          }),
        ),
    ],
    [
      "POST /api/v1/events/:slug/registrations/:registrationId/access",
      () => callApp(anonPost(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}/access`)),
    ],
    [
      "POST /api/v1/events/:slug/registrations/:registrationId/badge",
      () => callApp(anonPost(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}/badge`)),
    ],
    [
      "POST /api/v1/events/:slug/registrations/:registrationId/notifications",
      () =>
        callApp(
          anonPostBody(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}/notifications`, {
            type: "confirmation",
          }),
        ),
    ],
    [
      "GET /api/v1/events/:slug/registrations/:registrationId/audit",
      () => callApp(anonGet(`https://app.test/api/v1/events/${eventSlug}/registrations/${registrationId}/audit`)),
    ],
    [
      "POST /api/v1/proposals/:proposalId/decisions",
      () => callApp(anonPost(`https://app.test/api/v1/proposals/${proposalId}/decisions`)),
    ],
    [
      "GET /api/v1/proposals/:proposalId/reviews",
      () => callApp(anonGet(`https://app.test/api/v1/proposals/${proposalId}/reviews`)),
    ],
    [
      "POST /api/v1/proposals/:proposalId/reviews",
      () => callApp(anonPost(`https://app.test/api/v1/proposals/${proposalId}/reviews`)),
    ],
    [
      "PATCH /api/v1/proposals/:proposalId/reviews/:reviewId",
      () => callApp(anonPatch(`https://app.test/api/v1/proposals/${proposalId}/reviews/${reviewId}`)),
    ],
    [
      "GET /api/v1/proposals/:proposalId/speakers",
      () => callApp(anonGet(`https://app.test/api/v1/proposals/${proposalId}/speakers`)),
    ],
    // ── permission, role, and user-role endpoints ───────────
    ["GET /api/v1/permissions/grants", () => callApp(anonGet("https://app.test/api/v1/permissions/grants"))],
    ["POST /api/v1/permissions/grants", () => callApp(anonPost("https://app.test/api/v1/permissions/grants"))],
    [
      "DELETE /api/v1/permissions/grants/:id",
      () => callApp(anonDelete(`https://app.test/api/v1/permissions/grants/${grantId}`)),
    ],
    ["GET /api/v1/permissions/subjects", () => callApp(anonGet("https://app.test/api/v1/permissions/subjects"))],
    [
      "GET /api/v1/permissions/targets",
      () => callApp(anonGet("https://app.test/api/v1/permissions/targets?contextType=event")),
    ],
    ["GET /api/v1/roles", () => callApp(anonGet("https://app.test/api/v1/roles"))],
    ["POST /api/v1/roles", () => callApp(anonPost("https://app.test/api/v1/roles"))],
    ["DELETE /api/v1/roles/:id", () => callApp(anonDelete(`https://app.test/api/v1/roles/${roleId}`))],
    [
      "GET /api/v1/roles/:id/assignments",
      () => callApp(anonGet(`https://app.test/api/v1/roles/${roleId}/assignments`)),
    ],
    ["GET /api/v1/users/:userId/roles", () => callApp(anonGet(`https://app.test/api/v1/users/${userId}/roles`))],
    ["POST /api/v1/users/:userId/roles", () => callApp(anonPost(`https://app.test/api/v1/users/${userId}/roles`))],
    [
      "DELETE /api/v1/users/:userId/roles/:userRoleId",
      () => callApp(anonDelete(`https://app.test/api/v1/users/${userId}/roles/${userRoleId}`)),
    ],
    [
      "PATCH /api/v1/users/:userId/roles/:userRoleId",
      () => callApp(anonPatch(`https://app.test/api/v1/users/${userId}/roles/${userRoleId}`)),
    ],
    // ── passkey endpoints ───────────────────────────────────
    // authenticate/begin and authenticate/complete are deliberately excluded
    // here — they're the no-auth-required discovery/login flow, covered
    // instead under "public endpoints — accessible without credentials".
    [
      "POST /api/v1/auth/passkeys/register/begin",
      () => callApp(anonPost("https://app.test/api/v1/auth/passkeys/register/begin")),
    ],
    [
      "POST /api/v1/auth/passkeys/register/complete",
      () => callApp(anonPost("https://app.test/api/v1/auth/passkeys/register/complete")),
    ],
    ["GET /api/v1/auth/passkeys", () => callApp(anonGet("https://app.test/api/v1/auth/passkeys"))],
    [
      "DELETE /api/v1/auth/passkeys/:id",
      () => callApp(anonDelete(`https://app.test/api/v1/auth/passkeys/${passkeyId}`)),
    ],
  ];

  for (const [label, invoke] of cases) {
    it(`rejects ${label} with no Authorization header → AUTH_REQUIRED`, async () => {
      const response = await invoke();
      expect(response.status).toBe(401);
      const payload = (await response.json()) as { error?: { code?: string } };
      expect(payload.error?.code).toBe("AUTH_REQUIRED");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Session-token validation — all rejection modes + API key acceptance
// (tested via GET /api/v1/users as the representative endpoint)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-token validation", () => {
  beforeEach(async () => {
    await resetDb();
  });
  let adminId: string;
  let eventId: string;

  beforeEach(async () => {
    ({ eventId } = await seedEventAndAdmin(env.DB));
    // Retrieve the admin user id that seedEventAndAdmin created
    const row = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    adminId = row.id;
  });

  function callUsers(token: string): Promise<Response> {
    return callApp(bearerGet("https://app.test/api/v1/users", token));
  }

  it("rejects a garbage / non-existent token → AUTH_INVALID", async () => {
    const response = await callUsers("totally-invalid-token");
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("AUTH_INVALID");
  });

  it("rejects a well-formed but wrong token → AUTH_INVALID", async () => {
    // Create a session with known token, then query with a different one
    await createAdminSession(env.DB, adminId, "real-token");
    const response = await callUsers("wrong-token");
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("AUTH_INVALID");
  });

  it("rejects a cryptographically valid legacy human admin-session JWT", async () => {
    const legacyToken = await signJwt(env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret", {
      typ: "admin-session",
      sub: adminId,
      sid: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const response = await callUsers(legacyToken);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_INVALID" } });
  });

  it("rejects an expired session → AUTH_EXPIRED", async () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString(); // 1 s in the past
    const token = await insertSession(env.DB, adminId, "expired-token", { expiresAt: expiredAt });
    const response = await callUsers(token);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("AUTH_EXPIRED");
  });

  it("rejects a revoked session → AUTH_REVOKED", async () => {
    const token = await insertSession(env.DB, adminId, "revoked-token", { revokedAt: nowIso() });
    const response = await callUsers(token);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("AUTH_REVOKED");
  });

  it("rejects a token belonging to a non-admin user (role='user') → AUTH_INVALID", async () => {
    const regularUserId = crypto.randomUUID();
    await env.DB.prepare(
      `
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${regularUserId}', 'regular@example.test', 'regular@example.test',
              'user', 1, datetime('now'), datetime('now'));
    `,
    ).run();
    const token = await insertSession(env.DB, regularUserId, "user-token");
    // A regular user's session must not grant admin access
    const response = await callUsers(token);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("AUTH_INVALID");
  });

  it("rejects a token belonging to an inactive admin (active=0) → AUTH_INVALID", async () => {
    const inactiveAdminId = crypto.randomUUID();
    await env.DB.prepare(
      `
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${inactiveAdminId}', 'inactive@example.test', 'inactive@example.test',
              'admin', 0, datetime('now'), datetime('now'));
    `,
    ).run();
    const token = await insertSession(env.DB, inactiveAdminId, "inactive-admin-token");
    const response = await callUsers(token);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("AUTH_INVALID");
  });

  it("rejects a shared ADMIN_API_KEY where a user-backed identity is required", async () => {
    const response = await callUsers(env.ADMIN_API_KEY ?? "test-admin-key");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
  });

  it("accepts a valid active admin session token", async () => {
    const token = await createAdminSession(env.DB, adminId, "valid-admin-token");
    const response = await callUsers(token);
    expect(response.status).toBe(200);
  });

  it("rejects scoped sessions when the endpoint requires a different scope", async () => {
    const token = await insertSession(env.DB, adminId, "proposal-read-token", {
      scopes: ["proposals:read"],
    });
    const response = await callApp(mcpBearerGet("https://app.test/api/v1/users", token));
    expect(response.status).toBe(403);
    expect((await response.json()) as { error?: { code?: string; message?: string } }).toEqual({
      error: {
        code: "SCOPE_REQUIRED",
        details: null,
        message: PERMISSION_DENIED_MESSAGE,
      },
    });
  });

  it("requires proposal access in addition to event access for presentation archives", async () => {
    const readerId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'archive-reader@example.test', 'archive-reader@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(readerId)
      .run();
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'events:read', 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), readerId, eventId, adminId)
      .run();
    const token = await createAdminSession(env.DB, readerId, `archive-reader-${crypto.randomUUID()}`);
    const response = await callApp(bearerGet("https://app.test/api/v1/events/pqc-2026/presentations/archive", token));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_REQUIRED" },
    });

    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'proposals:read', 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), readerId, eventId, adminId)
      .run();
    const authorizedResponse = await callApp(
      bearerGet("https://app.test/api/v1/events/pqc-2026/presentations/archive", token),
    );
    expect(authorizedResponse.status).toBe(404);
    await expect(authorizedResponse.json()).resolves.toMatchObject({
      error: { code: "PRESENTATIONS_NOT_FOUND" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HTTP method enforcement (405 Method Not Allowed)
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP method enforcement", () => {
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await seedEventAndAdmin(env.DB);
    const row = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    adminId = row.id;
  });

  it("rejects POST to GET-only /api/v1/users", async () => {
    // P6M-P2-08: this route moved from a hand-rolled onRequest (which
    // explicitly 405'd unsupported methods) onto chanfana's openApiRoute —
    // registered as a GET-only OpenAPIRoute, so there is no exported
    // onRequest to call directly any more; go through the full router,
    // authenticated, instead. Hono has no handler for POST on this path, so
    // the unmatched method falls through to its default not-found response
    // rather than an explicit 405 — same as every other Chanfana-only
    // list route, none of which get
    // a 405 here either. The security-relevant invariant is just that POST
    // is not silently accepted as if it were GET.
    const token = await createAdminSession(env.DB, adminId, "method-enforcement-token");
    const response = await callApp(
      new Request("https://app.test/api/v1/users", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).not.toBe(200);
  });

  it("rejects POST to GET-only /api/v1/analytics/summary", async () => {
    const token = await createAdminSession(env.DB, adminId, "stats-method-enforcement-token");
    const response = await callApp(
      new Request("https://app.test/api/v1/analytics/summary", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(response.status).not.toBe(200);
  });

  it.each([
    "/api/v1/email/outbox/process",
    "/api/v1/email/outbox/reset-failed",
    "/api/v1/operations/reminders/run",
    "/api/v1/operations/retention/run",
  ])("does not accept GET on POST-only %s", async (path) => {
    const token = await createAdminSession(env.DB, adminId, `method-${path}`);
    const response = await callApp(
      new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(response.status).not.toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Public endpoints — accessible without any credentials
// ─────────────────────────────────────────────────────────────────────────────

describe("public endpoints — accessible without credentials", () => {
  beforeEach(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await seedEventAndAdmin(env.DB);
  });

  it("GET /api/v1/events/:slug/terms returns 200 without Authorization header", async () => {
    const response = await eventTermsGet(
      createContext(appEnv, new Request("https://app.test/api/v1/events/pqc-2026/terms"), { eventSlug: "pqc-2026" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { terms: unknown[] };
    expect(Array.isArray(body.terms)).toBe(true);
  });

  it("GET /api/v1/geolocation/country returns 200 for a same-origin request without Authorization header", async () => {
    const response = await geolocationCountryRequest(
      createContext(
        appEnv,
        new Request("https://app.test/api/v1/geolocation/country", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
        {},
      ),
    );
    expect(response.status).toBe(200);
    const body = geolocationCountryResponseSchema.parse(await response.json());
    expect(body.country).toBeNull();
  });

  it("GET /api/v1/geolocation/country returns and validates Cloudflare's country hint", async () => {
    const request = new Request("https://app.test/api/v1/geolocation/country", {
      headers: { "sec-fetch-site": "same-origin" },
    });
    Object.defineProperty(request, "cf", { value: { country: "NL" } });

    const response = await geolocationCountryRequest(createContext(appEnv, request, {}));

    expect(response.status).toBe(200);
    expect(geolocationCountryResponseSchema.parse(await response.json())).toEqual({ country: "NL" });
  });

  it("GET /api/v1/geolocation/country rejects cross-origin requests (CSRF guard) without any credentials needed", async () => {
    const response = await geolocationCountryRequest(
      createContext(
        appEnv,
        new Request("https://evil.example.com/steal", {
          headers: {
            "sec-fetch-site": "cross-site",
            origin: "https://evil.example.com",
          },
        }),
        {},
      ),
    );
    expect(response.status).toBe(403);
  });

  it("GET /api/v1/events/:slug/forms/placements/:purpose returns 200 without Authorization header", async () => {
    const response = await callApp(
      new Request("https://app.test/api/v1/events/pqc-2026/forms/placements/event_registration"),
    );
    expect(response.status).toBe(200);
  });

  // ── passkey discovery/login flow ──────────────────────────
  it("GET /api/v1/auth/passkeys/authenticate/begin returns 200 without Authorization header", async () => {
    const response = await callApp(anonGet("https://app.test/api/v1/auth/passkeys/authenticate/begin"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { challengeToken: string };
    expect(body.challengeToken).toBeTruthy();
  });

  it("POST /api/v1/auth/passkeys/authenticate/complete does not require an Authorization header", async () => {
    const response = await callApp(anonPost("https://app.test/api/v1/auth/passkeys/authenticate/complete"));
    // Missing challengeToken/response fails validation (400), not AUTH_REQUIRED (401).
    expect(response.status).not.toBe(401);
  });
});
