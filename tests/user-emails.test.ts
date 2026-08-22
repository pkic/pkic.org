/**
 * user-emails.test.ts
 *
 * Secondary email CRUD, global ownership constraints, searchable aliases,
 * and the "no login effect" decision (secondary emails must not resolve via
 * magic-link auth).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { requestAdminMagicLink } from "../functions/_lib/auth/admin";
import { addUserEmail, removeUserEmail } from "../functions/_lib/services/user-emails";

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

describe("secondary user emails", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-user-emails-token");
  });

  it("adds, lists, and removes a secondary email", async () => {
    const userId = await insertUser("primary@example.test");

    const addResponse = await call(adminToken, `/api/v1/admin/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "secondary@example.test" }),
    });
    expect(addResponse.status).toBe(201);
    const added = (await addResponse.json()) as { email: { id: string; email: string } };

    const listResponse = await call(adminToken, `/api/v1/admin/users/${userId}/emails`);
    const list = (await listResponse.json()) as { emails: Array<{ id: string; email: string }> };
    expect(list.emails.some((e) => e.id === added.email.id && e.email === "secondary@example.test")).toBe(true);

    const removeResponse = await call(adminToken, `/api/v1/admin/users/${userId}/emails/${added.email.id}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(200);

    const afterRemove = (await (await call(adminToken, `/api/v1/admin/users/${userId}/emails`)).json()) as {
      emails: Array<{ id: string }>;
    };
    expect(afterRemove.emails).toHaveLength(0);
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'user_email_%' ORDER BY created_at, rowid",
        userId,
      ),
    ).toEqual([{ action: "user_email_added" }, { action: "user_email_removed" }]);
  });

  it("rolls back secondary-email mutations when their audit cannot commit", async () => {
    const userId = await insertUser("atomic-email@example.test");
    const actor = { identityType: "user", id: adminId, email: "admin@pkic.org", role: "admin" } as const;
    await env.DB.prepare(
      `CREATE TRIGGER reject_user_email_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action IN ('user_email_added', 'user_email_removed')
       BEGIN
         SELECT RAISE(ABORT, 'forced user email audit failure');
       END`,
    ).run();

    await expect(addUserEmail(env.DB, actor, userId, "rollback-add@example.test")).rejects.toThrow(
      "forced user email audit failure",
    );
    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id = ?", userId)).toHaveLength(0);

    await env.DB.prepare("DROP TRIGGER reject_user_email_audit").run();
    const added = await addUserEmail(env.DB, actor, userId, "rollback-remove@example.test");
    await env.DB.prepare(
      `CREATE TRIGGER reject_user_email_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'user_email_removed'
       BEGIN
         SELECT RAISE(ABORT, 'forced user email audit failure');
       END`,
    ).run();
    try {
      await expect(removeUserEmail(env.DB, actor, userId, added.id)).rejects.toThrow("forced user email audit failure");
      expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE id = ?", added.id)).toHaveLength(1);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_user_email_audit").run();
    }
  });

  it("rejects adding an email that already belongs to another user's primary or secondary address", async () => {
    const userA = await insertUser("user-a@example.test");
    const userB = await insertUser("user-b@example.test");

    const clashPrimary = await call(adminToken, `/api/v1/admin/users/${userA}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "user-b@example.test" }),
    });
    expect(clashPrimary.status).toBe(409);

    await call(adminToken, `/api/v1/admin/users/${userB}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "shared-alias@example.test" }),
    });
    const clashSecondary = await call(adminToken, `/api/v1/admin/users/${userA}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "shared-alias@example.test" }),
    });
    expect(clashSecondary.status).toBe(409);
  });

  it("uses the same ownership boundary when an admin changes a primary email", async () => {
    const userA = await insertUser("primary-a@example.test");
    const userB = await insertUser("primary-b@example.test");
    await addUserEmail(
      env.DB,
      { identityType: "user", id: adminId, email: "admin@pkic.org", role: "admin" },
      userA,
      "alias-a@example.test",
    );
    await addUserEmail(
      env.DB,
      { identityType: "user", id: adminId, email: "admin@pkic.org", role: "admin" },
      userB,
      "alias-b@example.test",
    );

    const crossAccount = await call(adminToken, `/api/v1/admin/users/${userA}`, {
      method: "PATCH",
      body: JSON.stringify({ email: "alias-b@example.test" }),
    });
    expect(crossAccount.status).toBe(409);

    const ownAlias = await call(adminToken, `/api/v1/admin/users/${userA}`, {
      method: "PATCH",
      body: JSON.stringify({ email: "alias-a@example.test" }),
    });
    expect(ownAlias.status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id = ?", userA)).toHaveLength(0);
    expect(await queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", userA)).toEqual([
      { email: "alias-a@example.test" },
    ]);
  });

  it("enforces email reservations and disables partial identity markers in D1", async () => {
    const userA = await insertUser("guard-a@example.test");
    const userB = await insertUser("guard-b@example.test");
    const [{ id: eventId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM events LIMIT 1");
    const registrationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
    )
      .bind(crypto.randomUUID(), userA, "guard-alias@example.test", "guard-alias@example.test")
      .run();
    await env.DB.prepare(
      `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type,
          confirmation_link_secret, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'pending_email_confirmation', 'virtual', 'admin', ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(registrationId, eventId, userB, crypto.randomUUID(), crypto.randomUUID())
      .run();

    await expect(
      env.DB.prepare("UPDATE users SET pending_email = ?, pending_email_change_registration_id = ? WHERE id = ?")
        .bind("guard-alias@example.test", registrationId, userB)
        .run(),
    ).rejects.toThrow("EMAIL_TAKEN");
    await expect(
      env.DB.prepare("UPDATE users SET normalized_email = ?, email = ? WHERE id = ?")
        .bind("guard-alias@example.test", "guard-alias@example.test", userB)
        .run(),
    ).rejects.toThrow("EMAIL_TAKEN");
    await expect(
      env.DB.prepare("UPDATE users SET merged_into_user_id = ? WHERE id = ?").bind(userA, userB).run(),
    ).rejects.toThrow("USER_IDENTITY_MERGE_DISABLED");

    expect(
      await queryAll<{ merged_into_user_id: string | null }>(
        env.DB,
        "SELECT merged_into_user_id FROM users WHERE id = ?",
        userB,
      ),
    ).toEqual([{ merged_into_user_id: null }]);
  });

  it("does not expose a generic account-merge route", async () => {
    const survivorId = await insertUser("no-merge-survivor@example.test");
    const sourceId = await insertUser("no-merge-source@example.test");
    const response = await call(adminToken, `/api/v1/admin/users/${survivorId}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceUserId: sourceId }),
    });
    expect(response.status).toBe(404);
  });

  it("does not reactivate a legacy merged identity", async () => {
    const survivorId = await insertUser("legacy-survivor@example.test");
    const sourceId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (
         id, email, normalized_email, role, active, merged_into_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'user', 0, ?, datetime('now'), datetime('now'))`,
    )
      .bind(sourceId, "legacy-source@deleted.invalid", "legacy-source@deleted.invalid", survivorId)
      .run();

    const response = await call(adminToken, `/api/v1/admin/users/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
    expect(response.status).toBe(409);
    expect(await queryAll<{ active: number }>(env.DB, "SELECT active FROM users WHERE id = ?", sourceId)).toEqual([
      { active: 0 },
    ]);
  });

  it("adding a secondary email does not allow magic-link login via that alias", async () => {
    const userId = await insertUser("canonical@example.test");
    // Give this user staff access so it's eligible for a magic link at all.
    const staffRole = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM roles WHERE name = 'membership_processor'",
    );
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, staffRole[0].id, adminId)
      .run();

    await call(adminToken, `/api/v1/admin/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "alias@example.test" }),
    });

    const viaCanonical = await requestAdminMagicLink(env.DB, { email: "canonical@example.test", ttlMinutes: 15 });
    expect(viaCanonical.token).not.toBeNull();

    const viaAlias = await requestAdminMagicLink(env.DB, { email: "alias@example.test", ttlMinutes: 15 });
    expect(viaAlias.token).toBeNull();
    expect(viaAlias.admin).toBeNull();
  });

  it("Users list search matches a secondary email", async () => {
    const userId = await insertUser("findme-primary@example.test");
    await call(adminToken, `/api/v1/admin/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "findme-alias@example.test" }),
    });

    const searchResponse = await call(adminToken, "/api/v1/admin/users?q=findme-alias");
    const results = (await searchResponse.json()) as { users: Array<{ id: string }> };
    expect(results.users.some((u) => u.id === userId)).toBe(true);
  });
});
