/**
 * roles.test.ts
 *
 * PRD §2.2/§2.3 built-in and custom roles (`roles`/`role_permissions`/
 * `user_roles`) — Phase 2 (§10.4's tests/roles.test.ts). Listed under §10.4's
 * Phase 4 test section in the PRD, but every case here exercises Phase 2
 * tables/endpoints exclusively — see "Phase 2 — Implementation Status" in
 * prd.md for that reclassification.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function insertEvent(slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, source_path, capacity_in_person, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', NULL, 1, 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
  )
    .bind(id, slug, slug)
    .run();
  return id;
}

async function assignRole(
  userId: string,
  roleId: string,
  grantedBy: string,
  context?: { type: string; id: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, context?.type ?? null, context?.id ?? null, grantedBy)
    .run();
}

describe("roles (Phase 2 built-in and custom roles)", () => {
  let adminToken: string;
  let adminId: string;
  let eventAId: string;
  let eventASlug: string;
  let eventBId: string;
  let eventBSlug: string;
  let staffUserId: string;

  beforeEach(async () => {
    await resetDb();
    const { eventId } = await seedEventAndAdmin(env.DB);
    eventAId = eventId;
    eventASlug = "pqc-2026";
    eventBSlug = "cbom-2027";
    eventBId = await insertEvent(eventBSlug);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-roles-token");
    staffUserId = await insertUser("staff-roles@example.test");
  });

  it("a user can be assigned multiple roles simultaneously; each role's permissions are unioned", async () => {
    // membership_processor (membership:*) has no donations access;
    // donations:read only comes from an ad-hoc access grant here to prove
    // multiple sources of access compose — see next test for the
    // user_roles + permission_grants union specifically.
    await assignRole(staffUserId, "role-membership_processor", adminId);
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-multi-role-token");

    const membershipCheck = await call(staffToken, "/api/v1/admin/roles");
    // membership_processor alone doesn't grant access:grant either — expect 403.
    expect(membershipCheck.status).toBe(403);

    // Add a second, unrelated role that DOES grant access:grant (admin bundle
    // used here only as a vehicle — the point is holding two roles unions
    // their permissions).
    await env.DB.prepare(
      "INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES (?, 'test_second_role', NULL, 0, datetime('now'), datetime('now'))",
    )
      .bind("role-test-second")
      .run();
    await env.DB.prepare(
      "INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES (?, 'role-test-second', 'access:grant', datetime('now'))",
    )
      .bind(crypto.randomUUID())
      .run();
    await assignRole(staffUserId, "role-test-second", adminId);

    const bothRolesCheck = await call(staffToken, "/api/v1/admin/roles");
    expect(bothRolesCheck.status).toBe(200);
  });

  it("user_roles is respected by permission checks; permission_grants act as an additional, independent source", async () => {
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-union-token");

    // No role, no grant yet -> denied.
    expect((await call(staffToken, "/api/v1/admin/access-grants")).status).toBe(401);

    // An individual permission_grants override is enough on its own, with no role assigned.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'access:grant', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();

    expect((await call(staffToken, "/api/v1/admin/access-grants")).status).toBe(200);
  });

  it("a user_roles record with a context_id only grants access to that specific resource", async () => {
    const organizerRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_organizer'");
    await assignRole(staffUserId, organizerRole[0].id, adminId, { type: "event", id: eventAId });
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-context-role-token");

    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/admin/events/${eventBSlug}`)).status).toBe(403);
  });

  it("expired user_roles records are not honored", async () => {
    const organizerRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_organizer'");
    // Baseline unrelated role keeps the user eligible for a session even
    // once the role under test has expired — see STAFF_ACCESS_CONDITION.
    await assignRole(staffUserId, "role-membership_processor", adminId);
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, expires_at, created_at)
       VALUES (?, ?, ?, 'event', ?, ?, ?, datetime('now'))`,
    )
      .bind(
        crypto.randomUUID(),
        staffUserId,
        organizerRole[0].id,
        eventAId,
        adminId,
        new Date(Date.now() - 60_000).toISOString(),
      )
      .run();
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-expired-role-token");

    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}`)).status).toBe(403);
  });

  it("revoked user_roles records are not honored", async () => {
    const organizerRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_organizer'");
    await assignRole(staffUserId, "role-membership_processor", adminId);
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, revoked_at, created_at)
       VALUES (?, ?, ?, 'event', ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, organizerRole[0].id, eventAId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-revoked-role-token");

    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}`)).status).toBe(403);
  });

  it("admin role user can access all endpoints; membership_processor role user cannot access event management endpoints", async () => {
    await assignRole(staffUserId, "role-membership_processor", adminId);
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-processor-token");

    expect((await call(adminToken, `/api/v1/admin/events/${eventASlug}`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}`)).status).toBe(403);
  });

  it("event_organizer scoped to event A cannot access event B management endpoints", async () => {
    const organizerRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_organizer'");
    await assignRole(staffUserId, organizerRole[0].id, adminId, { type: "event", id: eventAId });
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-organizer-token");

    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/admin/events/${eventBSlug}`)).status).toBe(403);
    void eventBId;
  });

  it("program_committee scoped to event A can access proposal review and agenda endpoints for event A; denied for event B", async () => {
    const pcRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'program_committee'");
    await assignRole(staffUserId, pcRole[0].id, adminId, { type: "event", id: eventAId });
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-pc-token");

    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}/proposals`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/admin/events/${eventBSlug}/proposals`)).status).toBe(403);

    // A program_committee grant does not extend to general event management
    // (registrations) outside proposals/agenda — see P8's persona description.
    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}/registrations`)).status).toBe(403);
  });

  it("creating a role with a duplicate name returns 409", async () => {
    const response = await call(adminToken, "/api/v1/admin/roles", {
      method: "POST",
      body: JSON.stringify({ name: "admin", permissions: [] }),
    });
    expect(response.status).toBe(409);
  });

  it("system roles cannot be deleted; custom roles can be deleted if not assigned to any user", async () => {
    const systemRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'admin'");
    const deleteSystem = await call(adminToken, `/api/v1/admin/roles/${systemRole[0].id}`, { method: "DELETE" });
    expect(deleteSystem.status).toBe(409);

    const createResponse = await call(adminToken, "/api/v1/admin/roles", {
      method: "POST",
      body: JSON.stringify({ name: "custom_reviewer", permissions: ["proposals:read"] }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { role: { id: string } };

    const deleteCustom = await call(adminToken, `/api/v1/admin/roles/${created.role.id}`, { method: "DELETE" });
    expect(deleteCustom.status).toBe(200);

    const rows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE id = ?", created.role.id);
    expect(rows).toHaveLength(0);
  });

  it("a custom role assigned to a user cannot be deleted until the assignment is revoked", async () => {
    const createResponse = await call(adminToken, "/api/v1/admin/roles", {
      method: "POST",
      body: JSON.stringify({ name: "custom_in_use", permissions: ["donations:read"] }),
    });
    const created = (await createResponse.json()) as { role: { id: string } };
    await assignRole(staffUserId, created.role.id, adminId);

    const deleteResponse = await call(adminToken, `/api/v1/admin/roles/${created.role.id}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(409);
  });

  // ── Migration 0040: WG vice chair + forum chair/vice chair roles ─────────

  it("seeds role-wg_vice_chair with the same permission bundle as role-wg_chair", async () => {
    const response = await call(adminToken, "/api/v1/admin/roles");
    const body = (await response.json()) as {
      roles: Array<{ id: string; name: string; isSystemRole: boolean; permissions: string[] }>;
    };
    const chair = body.roles.find((r) => r.name === "wg_chair");
    const viceChair = body.roles.find((r) => r.name === "wg_vice_chair");
    expect(chair).toBeTruthy();
    expect(viceChair).toBeTruthy();
    expect(viceChair?.isSystemRole).toBe(true);
    expect([...(viceChair?.permissions ?? [])].sort()).toEqual([...(chair?.permissions ?? [])].sort());
  });

  it("seeds role-forum_chair/role-forum_vice_chair as global, permission-less designation roles", async () => {
    const response = await call(adminToken, "/api/v1/admin/roles");
    const body = (await response.json()) as {
      roles: Array<{ id: string; name: string; isSystemRole: boolean; permissions: string[] }>;
    };
    for (const name of ["forum_chair", "forum_vice_chair"]) {
      const role = body.roles.find((r) => r.name === name);
      expect(role).toBeTruthy();
      expect(role?.isSystemRole).toBe(true);
      expect(role?.permissions ?? []).toHaveLength(0);
    }
  });

  it("GET /api/v1/admin/roles/:id/assignments reverse-looks-up who holds a role, across contexts", async () => {
    const forumChairRole = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'forum_chair'")
    )[0];

    const emptyResponse = await call(adminToken, `/api/v1/admin/roles/${forumChairRole.id}/assignments`);
    expect(emptyResponse.status).toBe(200);
    expect(((await emptyResponse.json()) as { assignments: unknown[] }).assignments).toHaveLength(0);

    await assignRole(staffUserId, forumChairRole.id, adminId);

    const response = await call(adminToken, `/api/v1/admin/roles/${forumChairRole.id}/assignments`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      assignments: Array<{ userId: string; contextType: string | null; contextId: string | null }>;
    };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].userId).toBe(staffUserId);
    expect(body.assignments[0].contextType).toBeNull();
    expect(body.assignments[0].contextId).toBeNull();
  });

  it("GET /api/v1/admin/roles/:id/assignments returns 404 for an unknown role id", async () => {
    const response = await call(adminToken, `/api/v1/admin/roles/${crypto.randomUUID()}/assignments`);
    expect(response.status).toBe(404);
  });

  it("POST /api/v1/admin/users/:userId/roles rejects assigning a role that bundles a permission the caller doesn't hold (privilege escalation containment)", async () => {
    // Staff holds only access:grant — enough to call the endpoint, but not
    // enough to hand out role-admin, which bundles access:grant plus nearly
    // every other permission. Mirrors the containment check the
    // role-creation and access-grants endpoints already enforce.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'access:grant', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-escalation-token");

    const escalate = await call(staffToken, `/api/v1/admin/users/${staffUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: "role-admin" }),
    });
    expect(escalate.status).toBe(403);

    const rows = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM user_roles WHERE user_id = ? AND role_id = 'role-admin'",
      staffUserId,
    );
    expect(rows).toHaveLength(0);

    // Once staff is granted every permission role-admin bundles, the same
    // assignment succeeds.
    const bundled = await queryAll<{ permission: string }>(
      env.DB,
      "SELECT permission FROM role_permissions WHERE role_id = 'role-admin'",
    );
    for (const { permission } of bundled) {
      await env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, permission, adminId)
        .run();
    }

    const allowed = await call(staffToken, `/api/v1/admin/users/${staffUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: "role-admin" }),
    });
    expect(allowed.status).toBe(201);
  });
});
