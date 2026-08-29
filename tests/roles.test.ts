/**
 * roles.test.ts
 *
 * built-in and custom roles (`roles`/`role_permissions`/
 * `user_roles`) — (tests/roles.test.ts).
 * tables/endpoints exclusively. .
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrgRepresentative, REPRESENTATIVE_ROLE_IDS } from "./helpers/membership";
import { createRole, deleteRole } from "../functions/_lib/services/access-control/roles";
import {
  assignUserRole,
  revokeUserRoleAssignment,
  updateUserRoleAssignmentExpiry,
} from "../functions/_lib/services/access-control/user-role-assignments";
import type { AuthAdmin } from "../functions/_lib/types";
import { mutateBeforeNextBatch } from "./helpers/database-races";

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

describe("roles (Built-in and custom roles)", () => {
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

    const membershipCheck = await call(staffToken, "/api/v1/roles");
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

    const bothRolesCheck = await call(staffToken, "/api/v1/roles");
    expect(bothRolesCheck.status).toBe(200);
  });

  it("user_roles is respected by permission checks; permission_grants act as an additional, independent source", async () => {
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-union-token");

    // No role, no grant yet -> denied.
    expect((await call(staffToken, "/api/v1/permissions/grants")).status).toBe(401);

    // An individual permission_grants override is enough on its own, with no role assigned.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'access:grant', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();

    expect((await call(staffToken, "/api/v1/permissions/grants")).status).toBe(200);
  });

  it("a user_roles record with a context_id only grants access to that specific resource", async () => {
    const organizerRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_organizer'");
    await assignRole(staffUserId, organizerRole[0].id, adminId, {
      type: "event",
      id: eventAId,
    });
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-context-role-token");

    expect((await call(staffToken, `/api/v1/events/${eventASlug}`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/events/${eventBSlug}`)).status).toBe(404);
  });

  it("keeps authorization with the same user when an email changes and does not transfer it on address reuse", async () => {
    const organizerRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_organizer'");
    await assignRole(staffUserId, organizerRole[0].id, adminId, {
      type: "event",
      id: eventAId,
    });
    const originalToken = await createAdminSession(env.DB, staffUserId, "staff-email-change-token");

    await env.DB.prepare(
      `UPDATE users
          SET email = 'staff-renamed@example.test', normalized_email = 'staff-renamed@example.test', updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(staffUserId)
      .run();
    const replacementUserId = await insertUser("staff-roles@example.test");
    const replacementToken = await createAdminSession(env.DB, replacementUserId, "replacement-address-token");

    expect((await call(originalToken, `/api/v1/events/${eventASlug}`)).status).toBe(200);
    expect((await call(replacementToken, `/api/v1/events/${eventASlug}`)).status).toBe(401);
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

    expect((await call(staffToken, `/api/v1/events/${eventASlug}`)).status).toBe(404);
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

    expect((await call(staffToken, `/api/v1/events/${eventASlug}`)).status).toBe(404);
  });

  it("admin role user can access all endpoints; membership_processor role user cannot access event management endpoints", async () => {
    await assignRole(staffUserId, "role-membership_processor", adminId);
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-processor-token");

    expect((await call(adminToken, `/api/v1/events/${eventASlug}`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/events/${eventASlug}`)).status).toBe(404);
  });

  it("event_organizer scoped to event A cannot access event B management endpoints", async () => {
    const organizerRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_organizer'");
    await assignRole(staffUserId, organizerRole[0].id, adminId, {
      type: "event",
      id: eventAId,
    });
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-organizer-token");

    expect((await call(staffToken, `/api/v1/events/${eventASlug}`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/events/${eventBSlug}`)).status).toBe(404);
    void eventBId;
  });

  it("program_committee scoped to event A can access proposal review and agenda endpoints for event A; denied for event B", async () => {
    const pcRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'program_committee'");
    await assignRole(staffUserId, pcRole[0].id, adminId, {
      type: "event",
      id: eventAId,
    });
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-pc-token");

    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}/proposals`)).status).toBe(200);
    expect((await call(staffToken, `/api/v1/admin/events/${eventBSlug}/proposals`)).status).toBe(403);

    // A program_committee grant does not extend to general event management
    // (registrations) outside proposals/agenda — see P8's persona description.
    expect((await call(staffToken, `/api/v1/admin/events/${eventASlug}/registrations`)).status).toBe(403);
  });

  it("creating a role with a duplicate name returns 409", async () => {
    const response = await call(adminToken, "/api/v1/roles", {
      method: "POST",
      body: JSON.stringify({ name: "admin", permissions: [] }),
    });
    expect(response.status).toBe(409);
  });

  it("system roles cannot be deleted; custom roles can be deleted if not assigned to any user", async () => {
    const systemRole = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'admin'");
    const deleteSystem = await call(adminToken, `/api/v1/roles/${systemRole[0].id}`, {
      method: "DELETE",
    });
    expect(deleteSystem.status).toBe(409);

    const createResponse = await call(adminToken, "/api/v1/roles", {
      method: "POST",
      body: JSON.stringify({
        name: "custom_reviewer",
        permissions: ["proposals:read"],
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { role: { id: string } };

    const deleteCustom = await call(adminToken, `/api/v1/roles/${created.role.id}`, {
      method: "DELETE",
    });
    expect(deleteCustom.status).toBe(200);

    const rows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE id = ?", created.role.id);
    expect(rows).toHaveLength(0);
  });

  it("a custom role with assignment history cannot be deleted, including after revocation", async () => {
    const createResponse = await call(adminToken, "/api/v1/roles", {
      method: "POST",
      body: JSON.stringify({
        name: "custom_in_use",
        permissions: ["donations:read"],
      }),
    });
    const created = (await createResponse.json()) as { role: { id: string } };
    await assignRole(staffUserId, created.role.id, adminId);

    const deleteResponse = await call(adminToken, `/api/v1/roles/${created.role.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(409);

    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE role_id = ?")
      .bind(created.role.id)
      .run();
    const deleteAfterRevocation = await call(adminToken, `/api/v1/roles/${created.role.id}`, {
      method: "DELETE",
    });
    expect(deleteAfterRevocation.status).toBe(409);
    expect((await deleteAfterRevocation.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ROLE_HAS_ASSIGNMENT_HISTORY" },
    });
  });

  // ── Consolidated migration 0035: canonical group leadership roles ───────

  it("seeds group deputy lead with the same permission bundle as group lead", async () => {
    const response = await call(adminToken, "/api/v1/roles");
    const body = (await response.json()) as {
      roles: Array<{
        id: string;
        name: string;
        isSystemRole: boolean;
        permissions: string[];
      }>;
    };
    const lead = body.roles.find((r) => r.name === "group_lead");
    const deputy = body.roles.find((r) => r.name === "group_deputy_lead");
    expect(lead).toBeTruthy();
    expect(deputy).toBeTruthy();
    expect(deputy?.isSystemRole).toBe(true);
    expect([...(deputy?.permissions ?? [])].sort()).toEqual([...(lead?.permissions ?? [])].sort());
  });

  it("does not seed legacy forum or working-group-specific leadership roles", async () => {
    const response = await call(adminToken, "/api/v1/roles");
    const body = (await response.json()) as {
      roles: Array<{
        id: string;
        name: string;
        isSystemRole: boolean;
        permissions: string[];
      }>;
    };
    for (const name of ["forum_chair", "forum_vice_chair", "wg_chair", "wg_vice_chair"]) {
      expect(body.roles.find((r) => r.name === name)).toBeUndefined();
    }
  });

  // ── P6M-P2-07: `data.query`-driven sort + real pagination ────────────────

  it("GET /api/v1/roles honors a valid ?sort= (resolved from data.query, not a second URL parse)", async () => {
    const ascending = await call(adminToken, "/api/v1/roles?sort=name");
    expect(ascending.status).toBe(200);
    const ascendingBody = (await ascending.json()) as {
      roles: Array<{ name: string }>;
    };
    const ascendingNames = ascendingBody.roles.map((r) => r.name);
    expect(ascendingNames).toEqual([...ascendingNames].sort());

    const descending = await call(adminToken, "/api/v1/roles?sort=-name");
    expect(descending.status).toBe(200);
    const descendingBody = (await descending.json()) as {
      roles: Array<{ name: string }>;
    };
    const descendingNames = descendingBody.roles.map((r) => r.name);
    expect(descendingNames).toEqual([...ascendingNames].reverse());
  });

  it("GET /api/v1/roles rejects an unknown ?sort= column with 400 (rolesListQuerySchema's allowlist runs before the handler; nothing left in the handler quietly falls back)", async () => {
    const response = await call(adminToken, "/api/v1/roles?sort=not_a_real_column");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/v1/roles applies shared search and returns the page role's permissions", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at)
         VALUES ('role-search-target', 'search_target', 'Unique catalog description', 0, datetime('now'), datetime('now'))`,
      ),
      env.DB.prepare(
        `INSERT INTO role_permissions (id, role_id, permission, created_at)
         VALUES (?, 'role-search-target', 'events:read', datetime('now'))`,
      ).bind(crypto.randomUUID()),
    ]);

    const response = await call(adminToken, "/api/v1/roles?q=catalog&limit=1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      roles: Array<{ name: string; permissions: string[] }>;
      page: { total: number };
    };
    expect(body.roles).toHaveLength(1);
    expect(body.roles[0]).toMatchObject({
      name: "search_target",
      permissions: ["events:read"],
    });
    expect(body.page.total).toBe(1);
  });

  it("GET /api/v1/roles paginates with real LIMIT/OFFSET and a page envelope", async () => {
    const unpaged = await call(adminToken, "/api/v1/roles?sort=name");
    const unpagedBody = (await unpaged.json()) as {
      roles: Array<{ name: string }>;
      page: { total: number };
    };
    const totalRoles = unpagedBody.page.total;
    expect(totalRoles).toBeGreaterThan(2);
    expect(unpagedBody.roles).toHaveLength(totalRoles);

    const firstPage = await call(adminToken, "/api/v1/roles?sort=name&limit=2&offset=0");
    expect(firstPage.status).toBe(200);
    const firstPageBody = (await firstPage.json()) as {
      roles: Array<{ name: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstPageBody.roles).toHaveLength(2);
    expect(firstPageBody.page).toEqual({
      limit: 2,
      offset: 0,
      total: totalRoles,
      hasMore: true,
    });
    expect(firstPageBody.roles.map((r) => r.name)).toEqual(unpagedBody.roles.slice(0, 2).map((r) => r.name));

    const secondPage = await call(adminToken, "/api/v1/roles?sort=name&limit=2&offset=2");
    expect(secondPage.status).toBe(200);
    const secondPageBody = (await secondPage.json()) as {
      roles: Array<{ name: string }>;
      page: { offset: number };
    };
    expect(secondPageBody.page.offset).toBe(2);
    expect(secondPageBody.roles.map((r) => r.name)).toEqual(unpagedBody.roles.slice(2, 4).map((r) => r.name));
  });

  it("GET /api/v1/roles/:id/assignments searches, sorts, and paginates only effective holders", async () => {
    const assignmentRole = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'event_volunteer'")
    )[0];

    const emptyResponse = await call(adminToken, `/api/v1/roles/${assignmentRole.id}/assignments`);
    expect(emptyResponse.status).toBe(200);
    expect(await emptyResponse.json()).toMatchObject({
      assignments: [],
      page: { limit: 25, offset: 0, total: 0, hasMore: false },
    });

    await env.DB.prepare("UPDATE users SET first_name = 'Zelda', last_name = 'Zulu' WHERE id = ?")
      .bind(staffUserId)
      .run();
    await assignRole(staffUserId, assignmentRole.id, adminId);
    const alphaUserId = await insertUser("alpha-holder@example.test");
    await env.DB.prepare("UPDATE users SET first_name = 'Alpha', last_name = 'Able' WHERE id = ?")
      .bind(alphaUserId)
      .run();
    await assignRole(alphaUserId, assignmentRole.id, adminId, {
      type: "event",
      id: eventAId,
    });
    const expiredUserId = await insertUser("expired-holder@example.test");
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, granted_by_user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, '2020-01-01T00:00:00.000Z', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), expiredUserId, assignmentRole.id, adminId)
      .run();

    const searchResponse = await call(
      adminToken,
      `/api/v1/roles/${assignmentRole.id}/assignments?q=${encodeURIComponent("Alpha Able")}&sort=name&limit=1&offset=0`,
    );
    expect(searchResponse.status).toBe(200);
    expect(await searchResponse.json()).toMatchObject({
      assignments: [
        {
          userId: alphaUserId,
          name: "Alpha Able",
          contextType: "event",
          contextId: eventAId,
        },
      ],
      page: { limit: 1, offset: 0, total: 1, hasMore: false },
    });

    const firstPage = await call(
      adminToken,
      `/api/v1/roles/${assignmentRole.id}/assignments?sort=-email&limit=1&offset=0`,
    );
    const firstBody = (await firstPage.json()) as {
      assignments: Array<{ userId: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstBody.assignments.map((assignment) => assignment.userId)).toEqual([staffUserId]);
    expect(firstBody.page).toEqual({
      limit: 1,
      offset: 0,
      total: 2,
      hasMore: true,
    });

    const finalPage = await call(
      adminToken,
      `/api/v1/roles/${assignmentRole.id}/assignments?sort=-email&limit=1&offset=1`,
    );
    expect(await finalPage.json()).toMatchObject({
      assignments: [{ userId: alphaUserId }],
      page: { limit: 1, offset: 1, total: 2, hasMore: false },
    });
  });

  it("GET /api/v1/roles/:id/assignments returns 404 for an unknown role id", async () => {
    const response = await call(adminToken, `/api/v1/roles/${crypto.randomUUID()}/assignments`);
    expect(response.status).toBe(404);
  });

  it("GET /api/v1/users/:userId/roles searches, sorts, and paginates non-revoked history", async () => {
    const targetUserId = await insertUser("role-history@example.test");
    const roles = await queryAll<{ id: string; name: string }>(
      env.DB,
      "SELECT id, name FROM roles ORDER BY name ASC LIMIT 3",
    );
    expect(roles).toHaveLength(3);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_roles
             (id, user_id, role_id, granted_by_user_id, expires_at, created_at)
           VALUES (?, ?, ?, ?, NULL, '2026-01-01T00:00:00.000Z')`,
      ).bind(crypto.randomUUID(), targetUserId, roles[0].id, adminId),
      env.DB.prepare(
        `INSERT INTO user_roles
             (id, user_id, role_id, granted_by_user_id, expires_at, created_at)
           VALUES (?, ?, ?, ?, '2020-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
      ).bind(crypto.randomUUID(), targetUserId, roles[1].id, adminId),
      env.DB.prepare(
        `INSERT INTO user_roles
             (id, user_id, role_id, granted_by_user_id, revoked_at, created_at)
           VALUES (?, ?, ?, ?, '2026-01-04T00:00:00.000Z', '2026-01-03T00:00:00.000Z')`,
      ).bind(crypto.randomUUID(), targetUserId, roles[2].id, adminId),
    ]);

    const empty = await call(adminToken, `/api/v1/users/${staffUserId}/roles?q=no-such-role`);
    expect(await empty.json()).toMatchObject({
      roles: [],
      page: { limit: 25, offset: 0, total: 0, hasMore: false },
    });

    const searched = await call(
      adminToken,
      `/api/v1/users/${targetUserId}/roles?q=${encodeURIComponent(roles[1].name)}&sort=role_name`,
    );
    expect(await searched.json()).toMatchObject({
      roles: [{ roleName: roles[1].name, expiresAt: "2020-01-01T00:00:00.000Z" }],
      page: { total: 1, hasMore: false },
    });

    const firstPage = await call(adminToken, `/api/v1/users/${targetUserId}/roles?sort=role_name&limit=1&offset=0`);
    expect(await firstPage.json()).toMatchObject({
      roles: [{ roleName: roles[0].name }],
      page: { limit: 1, offset: 0, total: 2, hasMore: true },
    });
    const finalPage = await call(adminToken, `/api/v1/users/${targetUserId}/roles?sort=role_name&limit=1&offset=1`);
    expect(await finalPage.json()).toMatchObject({
      roles: [{ roleName: roles[1].name }],
      page: { limit: 1, offset: 1, total: 2, hasMore: false },
    });
  });

  it("POST /api/v1/users/:userId/roles rejects assigning a role that bundles a permission the caller doesn't hold (privilege escalation containment)", async () => {
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

    const escalate = await call(staffToken, `/api/v1/users/${staffUserId}/roles`, {
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
      if (permission === "access:grant") continue;
      await env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, permission, adminId)
        .run();
    }

    const allowed = await call(staffToken, `/api/v1/users/${staffUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: "role-admin" }),
    });
    expect(allowed.status).toBe(201);
  });

  it("rolls back role creation when the actor loses a required permission before commit", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const name = `Racing role ${crypto.randomUUID()}`;
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );

    await expect(createRole(racingDb, actor, { name, permissions: ["events:read"] })).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(await queryAll(env.DB, "SELECT id FROM roles WHERE name = ?", [name])).toHaveLength(0);
  });

  it("rolls back role deletion when the actor loses authority before commit", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const roleId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at)
         VALUES (?, ?, NULL, 0, datetime('now'), datetime('now'))`,
    )
      .bind(roleId, `Racing deletion ${crypto.randomUUID()}`)
      .run();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );

    await expect(deleteRole(racingDb, actor, roleId)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(await queryAll(env.DB, "SELECT id FROM roles WHERE id = ?", [roleId])).toHaveLength(1);
  });

  it("reports a conflict without a false audit when another writer deletes the role first", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const roleId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at)
         VALUES (?, ?, NULL, 0, datetime('now'), datetime('now'))`,
    )
      .bind(roleId, `Concurrent deletion ${crypto.randomUUID()}`)
      .run();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("DELETE FROM roles WHERE id = ?").bind(roleId).run(),
    );

    await expect(deleteRole(racingDb, actor, roleId)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_TARGET_CHANGED",
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'role_deleted' AND entity_id = ?", [roleId]),
    ).toHaveLength(0);
  });

  it("rolls back role assignment when the actor loses authority before commit", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );

    await expect(
      assignUserRole(racingDb, actor, staffUserId, {
        roleId: "role-membership_processor",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?", [
        staffUserId,
        "role-membership_processor",
      ]),
    ).toHaveLength(0);
  });

  it("rolls back role revocation and expiry updates when the actor loses authority before commit", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const assignmentId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO user_roles
           (id, user_id, role_id, context_type, context_id, granted_by_user_id, single_holder_per_context, created_at)
         VALUES (?, ?, 'role-membership_processor', NULL, NULL, ?, 0, datetime('now'))`,
    )
      .bind(assignmentId, staffUserId, adminId)
      .run();
    const revokeDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );
    await expect(revokeUserRoleAssignment(revokeDb, actor, staffUserId, assignmentId)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM user_roles WHERE id = ?", [
        assignmentId,
      ]),
    ).toEqual([{ revoked_at: null }]);

    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
    const expiryDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );
    await expect(
      updateUserRoleAssignmentExpiry(expiryDb, actor, staffUserId, assignmentId, {
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll<{ expires_at: string | null }>(env.DB, "SELECT expires_at FROM user_roles WHERE id = ?", [
        assignmentId,
      ]),
    ).toEqual([{ expires_at: null }]);
  });

  it("does not overwrite or falsely audit concurrent role-assignment target changes", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const revokeId = crypto.randomUUID();
    const expiryId = crypto.randomUUID();
    const expiryUserId = await insertUser(`expiry-race-${crypto.randomUUID()}@example.test`);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_roles
             (id, user_id, role_id, context_type, context_id, granted_by_user_id, single_holder_per_context, created_at)
           VALUES (?, ?, 'role-membership_processor', NULL, NULL, ?, 0, datetime('now'))`,
      ).bind(revokeId, staffUserId, adminId),
      env.DB.prepare(
        `INSERT INTO user_roles
             (id, user_id, role_id, context_type, context_id, granted_by_user_id, single_holder_per_context, created_at)
           VALUES (?, ?, 'role-membership_processor', NULL, NULL, ?, 0, datetime('now'))`,
      ).bind(expiryId, expiryUserId, adminId),
    ]);
    const revokeDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(revokeId).run(),
    );
    await expect(revokeUserRoleAssignment(revokeDb, actor, staffUserId, revokeId)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_TARGET_CHANGED",
    });

    const concurrentExpiry = "2029-01-01T00:00:00.000Z";
    const expiryDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET expires_at = ? WHERE id = ?").bind(concurrentExpiry, expiryId).run(),
    );
    await expect(
      updateUserRoleAssignmentExpiry(expiryDb, actor, expiryUserId, expiryId, {
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_TARGET_CHANGED",
    });
    expect(
      await queryAll<{ expires_at: string | null }>(env.DB, "SELECT expires_at FROM user_roles WHERE id = ?", [
        expiryId,
      ]),
    ).toEqual([{ expires_at: concurrentExpiry }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_id IN (?, ?) AND action IN ('user_role_revoked', 'user_role_expiry_updated')",
        [revokeId, expiryId],
      ),
    ).toHaveLength(0);
  });

  it("retires the legacy admin bypass and active sessions when the global admin role is revoked", async () => {
    const assignmentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffUserId),
      env.DB.prepare(
        `INSERT INTO user_roles
             (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
           VALUES (?, ?, 'role-admin', NULL, NULL, ?, datetime('now'))`,
      ).bind(assignmentId, staffUserId, adminId),
    ]);
    const targetToken = await createAdminSession(env.DB, staffUserId, `legacy-admin-${crypto.randomUUID()}`);

    const response = await call(adminToken, `/api/v1/users/${staffUserId}/roles/${assignmentId}`, { method: "DELETE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    expect(await queryAll<{ role: string }>(env.DB, "SELECT role FROM users WHERE id = ?", [staffUserId])).toEqual([
      { role: "user" },
    ]);
    expect(
      await queryAll<{ revoked_at: string | null }>(
        env.DB,
        "SELECT revoked_at FROM sessions WHERE user_id = ? AND revoked_at IS NOT NULL",
        [staffUserId],
      ),
    ).toHaveLength(1);
    expect((await call(targetToken, "/api/v1/roles")).status).toBe(401);
  });

  it("rolls back legacy admin demotion and session revocation when the role target changes concurrently", async () => {
    const assignmentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffUserId),
      env.DB.prepare(
        `INSERT INTO user_roles
             (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
           VALUES (?, ?, 'role-admin', NULL, NULL, ?, datetime('now'))`,
      ).bind(assignmentId, staffUserId, adminId),
    ]);
    await createAdminSession(env.DB, staffUserId, `legacy-admin-race-${crypto.randomUUID()}`);
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(assignmentId).run(),
    );

    await expect(revokeUserRoleAssignment(racedDb, actor, staffUserId, assignmentId)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_TARGET_CHANGED",
    });
    expect(await queryAll<{ role: string }>(env.DB, "SELECT role FROM users WHERE id = ?", [staffUserId])).toEqual([
      { role: "admin" },
    ]);
    expect(
      await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM sessions WHERE user_id = ?", [
        staffUserId,
      ]),
    ).toEqual([{ revoked_at: null }]);
  });

  it("rejects API-key role assignment because System access control requires a user-backed session", async () => {
    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    const generic = await call(apiKey, `/api/v1/users/${staffUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: "role-membership_processor" }),
    });
    expect(generic.status).toBe(403);
    expect(await generic.json()).toMatchObject({
      error: { code: "USER_BACKED_ADMIN_REQUIRED" },
    });

    expect(
      await queryAll<{ role_id: string }>(
        env.DB,
        "SELECT role_id FROM user_roles WHERE user_id = ? AND role_id = 'role-membership_processor'",
        [staffUserId],
      ),
    ).toHaveLength(0);
  });

  describe("POST /api/v1/users/:userId/roles rejects representative role IDs granted outside an organization context", () => {
    // An organization-contact role (primary/secondary contact) is
    // singleton-per-organization and carries a service-layer invariant (the
    // target user must actively represent the organization). The mounted
    // route must reject every context other than
    // contextType='organization' + a real contextId outright — it must
    // never fall through to the generic single_holder_per_context insert
    // path, which has no concept of "actively represents this org".
    for (const roleId of [REPRESENTATIVE_ROLE_IDS.primaryContact, REPRESENTATIVE_ROLE_IDS.secondaryContact]) {
      it(`rejects ${roleId} with no context at all`, async () => {
        const { userId } = await insertOrgRepresentative(env.DB);
        const response = await call(adminToken, `/api/v1/users/${userId}/roles`, {
          method: "POST",
          body: JSON.stringify({ roleId }),
        });
        expect(response.status).toBe(422);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe("REPRESENTATIVE_ROLE_REQUIRES_ORGANIZATION_CONTEXT");
        const rows = await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?", [
          userId,
          roleId,
        ]);
        expect(rows).toHaveLength(0);
      });

      it(`rejects ${roleId} with a group context`, async () => {
        const { userId } = await insertOrgRepresentative(env.DB);
        const response = await call(adminToken, `/api/v1/users/${userId}/roles`, {
          method: "POST",
          body: JSON.stringify({
            roleId,
            contextType: "group",
            contextId: crypto.randomUUID(),
          }),
        });
        expect(response.status).toBe(422);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe("REPRESENTATIVE_ROLE_REQUIRES_ORGANIZATION_CONTEXT");
        const rows = await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?", [
          userId,
          roleId,
        ]);
        expect(rows).toHaveLength(0);
      });

      it(`rejects ${roleId} with an event context`, async () => {
        const { userId } = await insertOrgRepresentative(env.DB);
        const response = await call(adminToken, `/api/v1/users/${userId}/roles`, {
          method: "POST",
          body: JSON.stringify({
            roleId,
            contextType: "event",
            contextId: eventAId,
          }),
        });
        expect(response.status).toBe(422);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe("REPRESENTATIVE_ROLE_REQUIRES_ORGANIZATION_CONTEXT");
        const rows = await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?", [
          userId,
          roleId,
        ]);
        expect(rows).toHaveLength(0);
      });

      it(`rejects ${roleId} with contextType='organization' but no contextId (schema-level rejection)`, async () => {
        const { userId } = await insertOrgRepresentative(env.DB);
        const response = await call(adminToken, `/api/v1/users/${userId}/roles`, {
          method: "POST",
          body: JSON.stringify({ roleId, contextType: "organization" }),
        });
        // contextType without a matching contextId is already rejected by
        // userRoleAssignSchema's superRefine before the handler runs — this
        // confirms the schema layer closes the gap too, not just the
        // handler's own check.
        expect(response.status).toBe(400);
        const rows = await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?", [
          userId,
          roleId,
        ]);
        expect(rows).toHaveLength(0);
      });
    }

    it("requires membership-management authority in addition to access:grant for contact designations", async () => {
      const representative = await insertOrgRepresentative(env.DB);
      await env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'access:grant', ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, adminId)
        .run();
      const staffToken = await createAdminSession(env.DB, staffUserId, `semantic-role-${crypto.randomUUID()}`);
      const input = {
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        contextType: "organization",
        contextId: representative.memberId,
      };

      const denied = await call(staffToken, `/api/v1/users/${representative.userId}/roles`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      expect(denied.status).toBe(403);
      expect((await denied.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "ORGANIZATION_REPRESENTATION_MANAGEMENT_REQUIRED" },
      });

      await env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'membership:write', ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, adminId)
        .run();
      const allowed = await call(staffToken, `/api/v1/users/${representative.userId}/roles`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      expect(allowed.status, await allowed.clone().text()).toBe(201);
    });

    it("rolls back a contact designation when membership-management authority is revoked before commit", async () => {
      const representative = await insertOrgRepresentative(env.DB);
      const membershipGrantId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
             VALUES (?, ?, 'access:grant', ?, datetime('now'))`,
        ).bind(crypto.randomUUID(), staffUserId, adminId),
        env.DB.prepare(
          `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
             VALUES (?, ?, 'membership:write', ?, datetime('now'))`,
        ).bind(membershipGrantId, staffUserId, adminId),
      ]);
      const actor: AuthAdmin = {
        identityType: "user",
        id: staffUserId,
        email: "staff-roles@example.test",
        role: "user",
        grants: [
          { permission: "access:grant", contextType: null, contextId: null },
          {
            permission: "membership:write",
            contextType: null,
            contextId: null,
          },
        ],
      };
      const racingDb = mutateBeforeNextBatch(env.DB, () =>
        env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
          .bind(membershipGrantId)
          .run(),
      );

      await expect(
        assignUserRole(racingDb, actor, representative.userId, {
          roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
          contextType: "organization",
          contextId: representative.memberId,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
      });
      expect(
        await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?", [
          representative.userId,
          REPRESENTATIVE_ROLE_IDS.secondaryContact,
        ]),
      ).toHaveLength(0);
    });

    it("requires membership-management authority to revoke a contact designation", async () => {
      const representative = await insertOrgRepresentative(env.DB);
      const adminActor: AuthAdmin = {
        identityType: "user",
        id: adminId,
        email: "admin@pkic.org",
        role: "admin",
      };
      const assignment = await assignUserRole(env.DB, adminActor, representative.userId, {
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        contextType: "organization",
        contextId: representative.memberId,
      });
      await env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'access:revoke', ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, adminId)
        .run();
      const staffToken = await createAdminSession(env.DB, staffUserId, `semantic-revoke-${crypto.randomUUID()}`);
      const path = `/api/v1/users/${representative.userId}/roles/${assignment.id}`;

      const denied = await call(staffToken, path, { method: "DELETE" });
      expect(denied.status).toBe(403);
      expect(
        await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM user_roles WHERE id = ?", [
          assignment.id,
        ]),
      ).toEqual([{ revoked_at: null }]);

      await env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'membership:write', ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, adminId)
        .run();
      const allowed = await call(staffToken, path, { method: "DELETE" });
      expect(allowed.status, await allowed.clone().text()).toBe(200);
    });

    it("still succeeds with a real organization context and an active representative", async () => {
      const { userId, memberId } = await insertOrgRepresentative(env.DB);
      const response = await call(adminToken, `/api/v1/users/${userId}/roles`, {
        method: "POST",
        body: JSON.stringify({
          roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
          contextType: "organization",
          contextId: memberId,
        }),
      });
      expect(response.status).toBe(201);
    });
  });
});
