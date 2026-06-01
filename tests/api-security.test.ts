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
import { signAdminSessionToken } from "../functions/_lib/auth/admin";
import type { AuthScope } from "../functions/_lib/auth/scopes";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { nowIso } from "../functions/_lib/utils/time";
import type { DatabaseLike, Env as AppEnv } from "../functions/_lib/types";

// ── Admin endpoint handlers ───────────────────────────────────────────────────
import { onRequest as adminUsersRequest } from "../functions/api/v1/admin/users";
import { onRequest as adminStatsRequest } from "../functions/api/v1/admin/stats";
import { onRequest as adminEmailTemplatesRequest } from "../functions/api/v1/admin/email-templates";
import { onRequest as internalEmailRetryRequest } from "../functions/api/v1/internal/email/retry";
import { onRequest as internalJobsRequest } from "../functions/api/v1/internal/jobs/run";
import { onRequest as internalEmailResetRequest } from "../functions/api/v1/internal/email/reset-failed";

// ── Public endpoint handlers ──────────────────────────────────────────────────
import { onRequestGet as eventTermsGet } from "../functions/api/v1/events/[eventSlug]/terms";
import {
  onRequestGet as eventFormsGet,
  onRequest as eventFormsRequest,
} from "../functions/api/v1/events/[eventSlug]/forms";
import { onRequest as geoRequest } from "../functions/api/v1/geo";

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

/** Makes a GET request with a Bearer token. */
function bearerGet(url: string, token: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

/** Makes a PATCH request with no Authorization header. */
function anonPatch(url: string): Request {
  return new Request(url, { method: "PATCH", body: "{}", headers: { "content-type": "application/json" } });
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

  return signAdminSessionToken(env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret", {
    admin: { id: userId, email: "admin@example.test", role: "admin" },
    sessionId,
    expiresAt,
    scopes: opts.scopes,
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
  const inviteId = crypto.randomUUID();
  const permId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const formKey = "test-form";
  const templateKey = "transactional";
  const reviewId = crypto.randomUUID();

  beforeEach(async () => {
    await seedEventAndAdmin(env.DB);
    eventSlug = "pqc-2026";
  });

  // Each entry: [description, thunk that invokes the real router with no auth]
  const cases: [string, () => Promise<Response>][] = [
    ["GET /api/v1/admin/users", () => callApp(anonGet("https://app.test/api/v1/admin/users"))],
    ["GET /api/v1/admin/stats", () => callApp(anonGet("https://app.test/api/v1/admin/stats"))],
    ["GET /api/v1/admin/donations", () => callApp(anonGet("https://app.test/api/v1/admin/donations"))],
    ["GET /api/v1/admin/audit-log", () => callApp(anonGet("https://app.test/api/v1/admin/audit-log"))],
    ["GET /api/v1/admin/email-templates", () => callApp(anonGet("https://app.test/api/v1/admin/email-templates"))],
    ["GET /api/v1/admin/events", () => callApp(anonGet("https://app.test/api/v1/admin/events"))],
    [
      "GET /api/v1/admin/events/:slug/registrations",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/registrations`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/invites",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/invites`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/forms",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/forms`)),
    ],
    ["GET /api/v1/admin/users/:id", () => callApp(anonGet(`https://app.test/api/v1/admin/users/${userId}`))],
    ["POST /api/v1/internal/email/retry", () => callApp(anonPost("https://app.test/api/v1/internal/email/retry"))],
    ["POST /api/v1/internal/jobs/run", () => callApp(anonPost("https://app.test/api/v1/internal/jobs/run"))],
    ["POST /api/v1/internal/reminders/run", () => callApp(anonPost("https://app.test/api/v1/internal/reminders/run"))],
    ["POST /api/v1/internal/retention/run", () => callApp(anonPost("https://app.test/api/v1/internal/retention/run"))],
    [
      "POST /api/v1/internal/email/reset-failed",
      () => callApp(anonPost("https://app.test/api/v1/internal/email/reset-failed")),
    ],
    // ── Additional admin endpoints ──────────────────────────────────────────
    ["POST /api/v1/admin/events", () => callApp(anonPost("https://app.test/api/v1/admin/events"))],
    ["POST /api/v1/admin/donations/sync", () => callApp(anonPost("https://app.test/api/v1/admin/donations/sync"))],
    [
      "POST /api/v1/admin/email-templates/preview",
      () => callApp(anonPost("https://app.test/api/v1/admin/email-templates/preview")),
    ],
    [
      "POST /api/v1/admin/email-templates/:key/activate",
      () => callApp(anonPost(`https://app.test/api/v1/admin/email-templates/${templateKey}/activate`)),
    ],
    [
      "POST /api/v1/admin/email-templates/:key/versions",
      () => callApp(anonPost(`https://app.test/api/v1/admin/email-templates/${templateKey}/versions`)),
    ],
    ["GET /api/v1/admin/forms/:formKey", () => callApp(anonGet(`https://app.test/api/v1/admin/forms/${formKey}`))],
    ["PATCH /api/v1/admin/forms/:formKey", () => callApp(anonPatch(`https://app.test/api/v1/admin/forms/${formKey}`))],
    [
      "DELETE /api/v1/admin/forms/:formKey",
      () => callApp(anonDelete(`https://app.test/api/v1/admin/forms/${formKey}`)),
    ],
    [
      "GET /api/v1/admin/forms/:formKey/submissions",
      () => callApp(anonGet(`https://app.test/api/v1/admin/forms/${formKey}/submissions`)),
    ],
    [
      "PATCH /api/v1/admin/users/:userId (global role)",
      () => callApp(anonPatch(`https://app.test/api/v1/admin/users/${userId}`)),
    ],
    [
      "PATCH /api/v1/admin/users/:userId (detail+role)",
      () => callApp(anonPatch(`https://app.test/api/v1/admin/users/${userId}`)),
    ],
    [
      "POST /api/v1/admin/users/:userId/anonymize",
      () => callApp(anonPost(`https://app.test/api/v1/admin/users/${userId}/anonymize`)),
    ],
    [
      "POST /api/v1/admin/users/:userId/gravatar",
      () => callApp(anonPost(`https://app.test/api/v1/admin/users/${userId}/gravatar`)),
    ],
    [
      "* /api/v1/admin/users/:userId/headshot",
      () => callApp(anonGet(`https://app.test/api/v1/admin/users/${userId}/headshot`)),
    ],
    [
      "POST /api/v1/admin/events/sync-from-hugo",
      () => callApp(anonPost("https://app.test/api/v1/admin/events/sync-from-hugo")),
    ],
    [
      "GET /api/v1/admin/events/:slug (detail)",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/days",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/days`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/forms",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/forms`)),
    ],
    [
      "PATCH /api/v1/admin/events/:slug/settings",
      () => callApp(anonPatch(`https://app.test/api/v1/admin/events/${eventSlug}/settings`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/terms",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/terms`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/permissions",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/permissions`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/permissions",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/permissions`)),
    ],
    [
      "DELETE /api/v1/admin/events/:slug/permissions/:permId",
      () => callApp(anonDelete(`https://app.test/api/v1/admin/events/${eventSlug}/permissions/${permId}`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/promoters",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/promoters`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/proposals",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/proposals`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/emails/campaign/preview",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/emails/campaign/preview`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/emails/campaign/send",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/emails/campaign/send`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/:inviteId/resend",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/${inviteId}/resend`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/attendees/bulk",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/attendees/bulk`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/attendees/preview",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/attendees/preview`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/invites/speakers/bulk",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/invites/speakers/bulk`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/admit",
      () =>
        callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/admit`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/registrations/:registrationId/badge-role",
      () =>
        callApp(
          anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/badge-role`),
        ),
    ],
    [
      "POST /api/v1/admin/events/:slug/waitlist/promote",
      () => callApp(anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/waitlist/promote`)),
    ],
    [
      "GET /api/v1/admin/events/:slug/registrations/:registrationId",
      () => callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}`)),
    ],
    [
      "PATCH /api/v1/admin/events/:slug/registrations/:registrationId",
      () => callApp(anonPatch(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}`)),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/open-manage",
      () =>
        callApp(
          anonPost(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/open-manage`),
        ),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/regenerate-badge",
      () =>
        callApp(
          anonPost(
            `https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/regenerate-badge`,
          ),
        ),
    ],
    [
      "POST /api/v1/admin/events/:slug/registrations/:registrationId/resend-confirmation",
      () =>
        callApp(
          anonPost(
            `https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/resend-confirmation`,
          ),
        ),
    ],
    [
      "GET /api/v1/admin/events/:slug/registrations/:registrationId/audit-log",
      () =>
        callApp(anonGet(`https://app.test/api/v1/admin/events/${eventSlug}/registrations/${registrationId}/audit-log`)),
    ],
    [
      "POST /api/v1/admin/proposals/:proposalId/finalize",
      () => callApp(anonPost(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`)),
    ],
    [
      "GET /api/v1/admin/proposals/:proposalId/reviews",
      () => callApp(anonGet(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`)),
    ],
    [
      "POST /api/v1/admin/proposals/:proposalId/reviews",
      () => callApp(anonPost(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`)),
    ],
    [
      "PATCH /api/v1/admin/proposals/:proposalId/reviews/:reviewId",
      () => callApp(anonPatch(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews/${reviewId}`)),
    ],
    [
      "GET /api/v1/admin/proposals/:proposalId/speakers",
      () => callApp(anonGet(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers`)),
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
// (tested via GET /api/v1/admin/users as the representative endpoint)
// ─────────────────────────────────────────────────────────────────────────────

describe("session-token validation", () => {
  beforeEach(async () => {
    await resetDb();
  });
  let adminId: string;

  beforeEach(async () => {
    await seedEventAndAdmin(env.DB);
    // Retrieve the admin user id that seedEventAndAdmin created
    const row = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    adminId = row.id;
  });

  function callUsers(token: string): Promise<Response> {
    return callApp(bearerGet("https://app.test/api/v1/admin/users", token));
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

  it("accepts a valid ADMIN_API_KEY as a bearer token", async () => {
    const response = await callUsers(env.ADMIN_API_KEY ?? "test-admin-key");
    expect(response.status).toBe(200);
  });

  it("accepts a valid active admin session token", async () => {
    const token = await createAdminSession(env.DB, adminId, "valid-admin-token");
    const response = await callUsers(token);
    expect(response.status).toBe(200);
  });

  it("rejects scoped sessions when the endpoint requires a different scope", async () => {
    const token = await insertSession(env.DB, adminId, "proposal-read-token", { scopes: ["proposals:read"] });
    const response = await callUsers(token);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("SCOPE_REQUIRED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HTTP method enforcement (405 Method Not Allowed)
// ─────────────────────────────────────────────────────────────────────────────

describe("HTTP method enforcement", () => {
  beforeEach(async () => {
    await resetDb();
  });

  beforeEach(async () => {
    await seedEventAndAdmin(env.DB);
  });

  it("rejects POST to GET-only /api/v1/admin/users → 405", async () => {
    const response = await adminUsersRequest(
      createContext(appEnv, new Request("https://app.test/api/v1/admin/users", { method: "POST" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects POST to GET-only /api/v1/admin/stats → 405", async () => {
    const response = await adminStatsRequest(
      createContext(appEnv, new Request("https://app.test/api/v1/admin/stats", { method: "POST" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects POST to GET-only /api/v1/admin/email-templates → 405", async () => {
    const response = await adminEmailTemplatesRequest(
      createContext(appEnv, new Request("https://app.test/api/v1/admin/email-templates", { method: "POST" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects GET to POST-only /api/v1/internal/email/retry → 405", async () => {
    const response = await internalEmailRetryRequest(
      createContext(appEnv, new Request("https://app.test/api/v1/internal/email/retry", { method: "GET" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects GET to POST-only /api/v1/internal/jobs/run → 405", async () => {
    const response = await internalJobsRequest(
      createContext(appEnv, new Request("https://app.test/api/v1/internal/jobs/run", { method: "GET" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects GET to POST-only /api/v1/internal/email/reset-failed → 405", async () => {
    const response = await internalEmailResetRequest(
      createContext(appEnv, new Request("https://app.test/api/v1/internal/email/reset-failed", { method: "GET" }), {}),
    );
    expect(response.status).toBe(405);
  });

  it("rejects POST to GET-only /api/v1/events/:slug/forms → 405", async () => {
    const response = await eventFormsRequest(
      createContext(appEnv, new Request("https://app.test/api/v1/events/pqc-2026/forms", { method: "POST" }), {
        eventSlug: "pqc-2026",
      }),
    );
    expect(response.status).toBe(405);
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

  it("GET /api/v1/geo returns 200 for a same-origin request without Authorization header", async () => {
    const response = await geoRequest(
      createContext(
        appEnv,
        new Request("https://app.test/api/v1/geo", {
          headers: { "sec-fetch-site": "same-origin" },
        }),
        {},
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { country: string | null };
    expect("country" in body).toBe(true);
  });

  it("GET /api/v1/geo rejects cross-origin requests (CSRF guard) without any credentials needed", async () => {
    const response = await geoRequest(
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

  it("GET /api/v1/events/:slug/forms returns 200 without Authorization header", async () => {
    const response = await eventFormsGet(
      createContext(appEnv, new Request("https://app.test/api/v1/events/pqc-2026/forms"), { eventSlug: "pqc-2026" }),
    );
    expect(response.status).toBe(200);
  });
});
