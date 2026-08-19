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

  // ── P6M-P2-07: `data.query`-driven sort + real pagination ────────────────

  it("GET /api/v1/admin/roles honors a valid ?sort= (resolved from data.query, not a second URL parse)", async () => {
    const ascending = await call(adminToken, "/api/v1/admin/roles?sort=name");
    expect(ascending.status).toBe(200);
    const ascendingBody = (await ascending.json()) as { roles: Array<{ name: string }> };
    const ascendingNames = ascendingBody.roles.map((r) => r.name);
    expect(ascendingNames).toEqual([...ascendingNames].sort());

    const descending = await call(adminToken, "/api/v1/admin/roles?sort=-name");
    expect(descending.status).toBe(200);
    const descendingBody = (await descending.json()) as { roles: Array<{ name: string }> };
    const descendingNames = descendingBody.roles.map((r) => r.name);
    expect(descendingNames).toEqual([...ascendingNames].reverse());
  });

  it("GET /api/v1/admin/roles rejects an unknown ?sort= column with 400 (rolesListQuerySchema's allowlist runs before the handler; nothing left in the handler quietly falls back)", async () => {
    const response = await call(adminToken, "/api/v1/admin/roles?sort=not_a_real_column");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/v1/admin/roles paginates with real LIMIT/OFFSET and a page envelope", async () => {
    const unpaged = await call(adminToken, "/api/v1/admin/roles?sort=name");
    const unpagedBody = (await unpaged.json()) as { roles: Array<{ name: string }>; page: { total: number } };
    const totalRoles = unpagedBody.page.total;
    expect(totalRoles).toBeGreaterThan(2);
    expect(unpagedBody.roles).toHaveLength(totalRoles);

    const firstPage = await call(adminToken, "/api/v1/admin/roles?sort=name&limit=2&offset=0");
    expect(firstPage.status).toBe(200);
    const firstPageBody = (await firstPage.json()) as {
      roles: Array<{ name: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstPageBody.roles).toHaveLength(2);
    expect(firstPageBody.page).toEqual({ limit: 2, offset: 0, total: totalRoles, hasMore: true });
    expect(firstPageBody.roles.map((r) => r.name)).toEqual(unpagedBody.roles.slice(0, 2).map((r) => r.name));

    const secondPage = await call(adminToken, "/api/v1/admin/roles?sort=name&limit=2&offset=2");
    expect(secondPage.status).toBe(200);
    const secondPageBody = (await secondPage.json()) as { roles: Array<{ name: string }>; page: { offset: number } };
    expect(secondPageBody.page.offset).toBe(2);
    expect(secondPageBody.roles.map((r) => r.name)).toEqual(unpagedBody.roles.slice(2, 4).map((r) => r.name));
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

  describe("POST /api/v1/admin/users/:userId/roles rejects representative role IDs granted outside an organization context", () => {
    // A representative role (primary/secondary contact, voting delegate) is
    // singleton-per-organization and carries a service-layer invariant (the
    // target user must actively represent the organization). The mounted
    // route must reject every context other than
    // contextType='organization' + a real contextId outright — it must
    // never fall through to the generic single_holder_per_context insert
    // path, which has no concept of "actively represents this org".
    for (const roleId of [
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
      REPRESENTATIVE_ROLE_IDS.votingDelegate,
    ]) {
      it(`rejects ${roleId} with no context at all`, async () => {
        const { userId } = await insertOrgRepresentative(env.DB);
        const response = await call(adminToken, `/api/v1/admin/users/${userId}/roles`, {
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

      it(`rejects ${roleId} with a working_group context`, async () => {
        const { userId } = await insertOrgRepresentative(env.DB);
        const response = await call(adminToken, `/api/v1/admin/users/${userId}/roles`, {
          method: "POST",
          body: JSON.stringify({ roleId, contextType: "working_group", contextId: crypto.randomUUID() }),
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
        const response = await call(adminToken, `/api/v1/admin/users/${userId}/roles`, {
          method: "POST",
          body: JSON.stringify({ roleId, contextType: "event", contextId: eventAId }),
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
        const response = await call(adminToken, `/api/v1/admin/users/${userId}/roles`, {
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

    it("still succeeds with a real organization context and an active representative", async () => {
      const { userId, memberId } = await insertOrgRepresentative(env.DB);
      const response = await call(adminToken, `/api/v1/admin/users/${userId}/roles`, {
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
