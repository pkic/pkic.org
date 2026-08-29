/**
 * permission-grants.test.ts
 *
 * `permission_grants` — (tests/permission-grants.test.ts).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { hasPermission } from "../functions/_lib/auth/permissions";
import type { AuthAdmin } from "../functions/_lib/types";
import { createAccessGrant, revokeAccessGrant } from "../functions/_lib/services/access-control/access-grants";
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

describe("permission_grants (Permission grants)", () => {
  let adminToken: string;
  let adminId: string;
  let eventAId: string;
  let eventASlug: string;
  let staffUserId: string;

  beforeEach(async () => {
    await resetDb();
    const { eventId } = await seedEventAndAdmin(env.DB);
    eventAId = eventId;
    eventASlug = "pqc-2026";
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-grants-token");
    staffUserId = await insertUser("staff@example.test");
  });

  it("POST /api/v1/permissions/grants creates a grant with context and expiry", async () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    const response = await call(adminToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "events:write",
        contextType: "event",
        contextId: eventAId,
        expiresAt,
      }),
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      grant: { id: string; permission: string; contextId: string };
    };
    expect(payload.grant.permission).toBe("events:write");
    expect(payload.grant.contextId).toBe(eventAId);

    const rows = await queryAll<{ id: string; expires_at: string }>(
      env.DB,
      "SELECT id, expires_at FROM permission_grants WHERE id = ?",
      payload.grant.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].expires_at).toBe(expiresAt);
  });

  it("rejects API-key authentication because System access control requires a user-backed session", async () => {
    const response = await call(env.ADMIN_API_KEY ?? "test-admin-key", "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "donations:read",
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "USER_BACKED_ADMIN_REQUIRED" },
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM permission_grants WHERE user_id = ? AND permission = 'donations:read'",
        staffUserId,
      ),
    ).toHaveLength(0);
  });

  it("rolls back an access grant when its required audit record cannot be written", async () => {
    await env.DB.prepare(
      `CREATE TRIGGER fail_access_grant_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'access_grant_created'
       BEGIN
         SELECT RAISE(ABORT, 'forced audit failure');
       END`,
    ).run();

    try {
      const response = await call(adminToken, "/api/v1/permissions/grants", {
        method: "POST",
        body: JSON.stringify({
          userId: staffUserId,
          permission: "donations:read",
        }),
      });
      expect(response.status).toBe(500);
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM permission_grants WHERE user_id = ? AND permission = 'donations:read'",
          staffUserId,
        ),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_access_grant_audit").run();
    }
  });

  it("returns a precise conflict when an active matching grant already exists", async () => {
    const first = await call(adminToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "donations:read",
      }),
    });
    expect(first.status).toBe(201);

    const duplicate = await call(adminToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "donations:read",
      }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "ACCESS_GRANT_EXISTS" },
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM permission_grants WHERE user_id = ? AND permission = ? AND revoked_at IS NULL",
        [staffUserId, "donations:read"],
      ),
    ).toHaveLength(1);
  });

  it("GET /api/v1/permissions/grants returns a bounded page envelope and filters by userId", async () => {
    const otherUserId = await insertUser("other@example.test");
    for (const permission of ["events:read", "events:write", "events:manage"] as const) {
      await env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, permission, adminId)
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'events:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), otherUserId, adminId)
      .run();

    const boundedResponse = await call(adminToken, "/api/v1/permissions/grants?limit=2&offset=0");
    expect(boundedResponse.status).toBe(200);
    const boundedPayload = (await boundedResponse.json()) as {
      grants: { id: string }[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(boundedPayload.grants).toHaveLength(2);
    expect(boundedPayload.page).toEqual({
      limit: 2,
      offset: 0,
      total: 4,
      hasMore: true,
    });

    const filteredResponse = await call(adminToken, `/api/v1/permissions/grants?userId=${otherUserId}`);
    expect(filteredResponse.status).toBe(200);
    const filteredPayload = (await filteredResponse.json()) as {
      grants: { userId: string }[];
      page: { total: number; hasMore: boolean };
    };
    expect(filteredPayload.grants).toHaveLength(1);
    expect(filteredPayload.grants[0].userId).toBe(otherUserId);
    expect(filteredPayload.page).toEqual({
      limit: 50,
      offset: 0,
      total: 1,
      hasMore: false,
    });
  });

  it("GET /api/v1/permissions/grants rejects a non-UUID userId filter", async () => {
    const response = await call(adminToken, "/api/v1/permissions/grants?userId=not-a-uuid");
    expect(response.status).toBe(400);
  });

  it("GET /api/v1/permissions/grants applies shared search in D1", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
         VALUES (?, ?, 'events:read', 'event', ?, ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), staffUserId, eventAId, adminId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), staffUserId, adminId),
    ]);

    const response = await call(adminToken, `/api/v1/permissions/grants?q=${eventAId}`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      grants: Array<{ permission: string }>;
      page: { total: number };
    };
    expect(payload.grants.map(({ permission }) => permission)).toEqual(["events:read"]);
    expect(payload.page.total).toBe(1);
  });

  it("expired grants are not honored", async () => {
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-expired-token");
    // Baseline unrelated grant keeps the user eligible for a session even
    // once the grant under test has expired — see STAFF_ACCESS_CONDITION.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, expires_at, created_at)
       VALUES (?, ?, 'events:read', 'event', ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, eventAId, adminId, new Date(Date.now() - 60_000).toISOString())
      .run();

    const response = await call(staffToken, `/api/v1/events/${eventASlug}`);
    expect(response.status).toBe(404);
  });

  it("revoked grants are not honored", async () => {
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-revoked-token");
    // A separate, still-active grant keeps the user eligible to obtain a
    // session at all (see STAFF_ACCESS_CONDITION in _lib/auth/admin.ts) —
    // isolates the assertion to "this specific revoked grant doesn't
    // authorize", not "a user with zero active grants can't log in".
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, revoked_at, created_at)
       VALUES (?, ?, 'events:read', 'event', ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, eventAId, adminId)
      .run();

    const response = await call(staffToken, `/api/v1/events/${eventASlug}`);
    expect(response.status).toBe(404);
  });

  it("a context-scoped grant does not authorize access to a different event", async () => {
    const eventBId = await insertEvent("cbom-2027");
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-context-token");

    const grantResponse = await call(adminToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "events:read",
        contextType: "event",
        contextId: eventAId,
      }),
    });
    expect(grantResponse.status).toBe(201);

    const okResponse = await call(staffToken, `/api/v1/events/${eventASlug}`);
    expect(okResponse.status).toBe(200);

    const deniedResponse = await call(staffToken, `/api/v1/events/cbom-2027`);
    expect(deniedResponse.status).toBe(404);
    void eventBId;
  });

  it("a group lead grant scoped to one group does not grant write access to another", () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: "wg-chair-user",
      email: "chair@example.test",
      role: "user",
      grants: [
        {
          permission: "groups:write",
          contextType: "group",
          contextId: "group-pqc",
        },
      ],
    };

    expect(hasPermission(actor, "groups:write", { type: "group", id: "group-pqc" })).toBe(true);
    expect(hasPermission(actor, "groups:write", { type: "group", id: "group-cbom" })).toBe(false);
  });

  it("caps even a global admin by delegated OAuth scopes when the token is scope-restricted", () => {
    const delegatedAdmin: AuthAdmin = {
      identityType: "user",
      id: "oauth-admin",
      email: "oauth-admin@example.test",
      role: "admin",
      scopes: ["proposals:read"],
      scopeRestricted: true,
    };

    expect(hasPermission(delegatedAdmin, "proposals:read")).toBe(true);
    expect(hasPermission(delegatedAdmin, "proposals:manage")).toBe(false);
    expect(hasPermission(delegatedAdmin, "events:write")).toBe(false);
  });

  it("DELETE /api/v1/permissions/grants/:id sets revoked_at and writes to audit_log", async () => {
    const createResponse = await call(adminToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "donations:read",
      }),
    });
    const created = (await createResponse.json()) as { grant: { id: string } };

    const deleteResponse = await call(adminToken, `/api/v1/permissions/grants/${created.grant.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);

    const rows = await queryAll<{ revoked_at: string | null }>(
      env.DB,
      "SELECT revoked_at FROM permission_grants WHERE id = ?",
      created.grant.id,
    );
    expect(rows[0].revoked_at).not.toBeNull();

    const auditRows = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE action = 'access_grant_revoked' AND entity_id = ?",
      created.grant.id,
    );
    expect(auditRows).toHaveLength(1);
  });

  it("rolls back access-grant creation when the actor loses authority before commit", async () => {
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
      createAccessGrant(racingDb, actor, {
        userId: staffUserId,
        permission: "donations:read",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM permission_grants WHERE user_id = ? AND permission = 'donations:read'",
        staffUserId,
      ),
    ).toHaveLength(0);
  });

  it("returns ACCESS_GRANT_EXISTS without an audit record when a concurrent writer creates the same active grant", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), staffUserId, adminId)
        .run(),
    );

    await expect(
      createAccessGrant(racingDb, actor, {
        userId: staffUserId,
        permission: "donations:read",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_GRANT_EXISTS",
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM permission_grants WHERE user_id = ? AND permission = ? AND revoked_at IS NULL",
        [staffUserId, "donations:read"],
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'access_grant_created' AND entity_id IN (SELECT id FROM permission_grants WHERE user_id = ?)",
        [staffUserId],
      ),
    ).toHaveLength(0);
  });

  it("rolls back access-grant revocation when the actor loses authority before commit", async () => {
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(grantId, staffUserId, adminId)
      .run();
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );

    await expect(revokeAccessGrant(racingDb, actor, grantId)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM permission_grants WHERE id = ?", [
        grantId,
      ]),
    ).toEqual([{ revoked_at: null }]);
  });

  it("reports a conflict without a false audit when another writer revokes the target first", async () => {
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(grantId, staffUserId, adminId)
      .run();
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?").bind(grantId).run(),
    );

    await expect(revokeAccessGrant(racingDb, actor, grantId)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_TARGET_CHANGED",
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'access_grant_revoked' AND entity_id = ?", [
        grantId,
      ]),
    ).toHaveLength(0);
  });

  it("only a user with access:grant can create a grant, and only access:revoke can revoke one", async () => {
    const staffToken = await createAdminSession(env.DB, staffUserId, "staff-perm-token");
    const granteeUserId = await insertUser("grant-target@example.test");
    // Baseline unrelated grant keeps the user eligible for a session even
    // before they hold any access:* permission — see STAFF_ACCESS_CONDITION.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'audit:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();

    const deniedCreate = await call(staffToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "donations:read",
      }),
    });
    expect(deniedCreate.status).toBe(403);

    // Give staff only access:grant — they still can't grant a permission
    // they don't themselves hold (containment check).
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'access:grant', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();

    const deniedUncontained = await call(staffToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: staffUserId,
        permission: "donations:read",
      }),
    });
    expect(deniedUncontained.status).toBe(403);

    // Give staff the permission they're trying to grant — create should now succeed.
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();

    const createResponse = await call(staffToken, "/api/v1/permissions/grants", {
      method: "POST",
      body: JSON.stringify({
        userId: granteeUserId,
        permission: "donations:read",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { grant: { id: string } };

    // access:grant alone must not authorize revocation.
    const deniedRevoke = await call(staffToken, `/api/v1/permissions/grants/${created.grant.id}`, {
      method: "DELETE",
    });
    expect(deniedRevoke.status).toBe(403);

    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'access:revoke', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, adminId)
      .run();

    const allowedRevoke = await call(staffToken, `/api/v1/permissions/grants/${created.grant.id}`, {
      method: "DELETE",
    });
    expect(allowedRevoke.status).toBe(200);
  });
});
