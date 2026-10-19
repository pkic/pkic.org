/** Human fixture sessions carry no authority; routes resolve their live role and permission grants. */
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";

async function callAppGet(path: string, token: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

async function insertNonAdminStaffUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
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

describe("canonical fixture sessions resolve live permissions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("allows a live administrator assignment", async () => {
    const { eventId: _eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    const token = await createAdminSession(env.DB, admin.id, "p4r01-admin-token");

    // The permission comes from the live administrator assignment.
    const response = await callAppGet("/api/v1/events/pqc-2026/registrations", token);
    expect(response.status).toBe(200);
  });

  it("denies an unrelated contextual staff assignment", async () => {
    // insertNonAdminStaffUser seeds the event; the gate resolves it before
    // checking permission, so this proves a 403 rather than a 404.
    const staffId = await insertNonAdminStaffUser("p4r01-staff@wf.test");
    const token = await createAdminSession(env.DB, staffId, "p4r01-staff-token");

    // Being staff does not grant an unrelated registration-list permission.
    const response = await callAppGet("/api/v1/events/pqc-2026/registrations", token);
    expect(response.status).toBe(403);
  });
});
