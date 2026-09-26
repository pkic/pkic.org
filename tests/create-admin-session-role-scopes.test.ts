/**
 * P4-R01: createAdminSession (tests/helpers/auth.ts) used to always sign a
 * full legacy AUTH_SCOPES array into the session token regardless of the
 * target user's real DB role, since getAdminBySessionClaims trusts the
 * token's own `scopes` claim (functions/_lib/auth/admin.ts) rather than
 * re-deriving it from the DB. That would have silently no-op'd any test
 * asserting legacy-scope denial for a non-admin-role user. These tests
 * prove the helper now signs role-accurate scopes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import app from "../functions/router";

async function callAppGet(path: string, token: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertNonAdminStaffUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  // A user_roles grant (any context) is what makes a non-admin-role user
  // eligible for a session at all (STAFF_ACCESS_CONDITION), matching the
  // pattern other tests use (see proposal-finalize-workflows.test.ts's
  // insertStaffUser + assignEventModerator).
  const { eventId } = await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1");
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, 'role-event_moderator', 'event', ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), id, eventId, admin.id)
    .run();
  return id;
}

describe("createAdminSession signs role-accurate scopes (P4-R01)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("grants full legacy AUTH_SCOPES for a real role='admin' user", async () => {
    const { eventId: _eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    const token = await createAdminSession(env.DB, admin.id, "p4r01-admin-token");

    // The admin event subresources remain legacy-scope-gated; a real
    // role='admin' user passes through requirePermission's role bypass.
    const response = await callAppGet("/api/v1/events/pqc-2026/registrations", token);
    expect(response.status).toBe(200);
  });

  it("does NOT grant legacy AUTH_SCOPES for a non-admin-role staff user", async () => {
    // insertNonAdminStaffUser seeds the event; the gate resolves it before
    // checking permission, so this proves a 403 rather than a 404.
    const staffId = await insertNonAdminStaffUser("p4r01-staff@wf.test");
    const token = await createAdminSession(env.DB, staffId, "p4r01-staff-token");

    // Same legacy-scope-gated path — a role='user' actor with no events:read
    // grant must be denied, proving the token's scopes claim reflects the
    // real DB role rather than always granting full AUTH_SCOPES.
    const response = await callAppGet("/api/v1/events/pqc-2026/registrations", token);
    expect(response.status).toBe(403);
  });
});
