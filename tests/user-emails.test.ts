/**
 * user-emails.test.ts
 *
 * Secondary email CRUD, global ownership constraints, searchable aliases,
 * and verified-alias sign-in into the same canonical user.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { queueUserSignInCapability, redeemUserSignInCapability } from "../functions/_lib/auth/user-session";
import { addUserEmail, removeUserEmail } from "../functions/_lib/services/user-emails";
import { gateNextBatch } from "./helpers/d1-batch-gate";

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

    const addResponse = await call(adminToken, `/api/v1/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "secondary@example.test" }),
    });
    expect(addResponse.status).toBe(201);
    const added = (await addResponse.json()) as { email: { id: string; email: string } };

    const listResponse = await call(adminToken, `/api/v1/users/${userId}/emails`);
    const list = (await listResponse.json()) as { emails: Array<{ id: string; email: string }> };
    expect(list.emails.some((e) => e.id === added.email.id && e.email === "secondary@example.test")).toBe(true);

    const removeResponse = await call(adminToken, `/api/v1/users/${userId}/emails/${added.email.id}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(200);

    const afterRemove = (await (await call(adminToken, `/api/v1/users/${userId}/emails`)).json()) as {
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

  it("lists secondary emails with mounted-route search, sort, empty, and final-page envelopes", async () => {
    const userId = await insertUser("paged-emails@example.test");
    const emptyResponse = await call(adminToken, `/api/v1/users/${userId}/emails`);
    expect(await emptyResponse.json()).toMatchObject({
      emails: [],
      page: { limit: 10, offset: 0, total: 0, hasMore: false },
    });

    for (const [email, createdAt] of [
      ["zulu-alias@example.test", "2026-01-01T00:00:00.000Z"],
      ["alpha-alias@example.test", "2026-01-02T00:00:00.000Z"],
      ["middle-alias@example.test", "2026-01-03T00:00:00.000Z"],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO user_emails (id, user_id, email, normalized_email, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), userId, email, email, createdAt)
        .run();
    }

    const searched = await call(adminToken, `/api/v1/users/${userId}/emails?q=middle&sort=email`);
    expect(await searched.json()).toMatchObject({
      emails: [{ email: "middle-alias@example.test" }],
      page: { total: 1, hasMore: false },
    });

    const firstPage = await call(adminToken, `/api/v1/users/${userId}/emails?sort=email&limit=2&offset=0`);
    expect(await firstPage.json()).toMatchObject({
      emails: [{ email: "alpha-alias@example.test" }, { email: "middle-alias@example.test" }],
      page: { limit: 2, offset: 0, total: 3, hasMore: true },
    });

    const finalPage = await call(adminToken, `/api/v1/users/${userId}/emails?sort=email&limit=2&offset=2`);
    expect(await finalPage.json()).toMatchObject({
      emails: [{ email: "zulu-alias@example.test" }],
      page: { limit: 2, offset: 2, total: 3, hasMore: false },
    });
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

  it("does not attach a secondary email after the target is anonymized during the commit race", async () => {
    const userId = await insertUser("email-target-race@example.test");
    const actor = { identityType: "user", id: adminId, email: "admin@pkic.org", role: "admin" } as const;
    const gate = gateNextBatch(env.DB);
    const mutation = addUserEmail(gate.db, actor, userId, "must-not-attach@example.test");
    await gate.reached;
    await env.DB.prepare(
      "UPDATE users SET pii_redacted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(userId)
      .run();
    gate.release();

    await expect(mutation).rejects.toMatchObject({ status: 409, code: "USER_LIFECYCLE_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id = ?", userId)).toEqual([]);
  });

  it("rejects adding an email that already belongs to another user's primary or secondary address", async () => {
    const userA = await insertUser("user-a@example.test");
    const userB = await insertUser("user-b@example.test");

    const clashPrimary = await call(adminToken, `/api/v1/users/${userA}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "user-b@example.test" }),
    });
    expect(clashPrimary.status).toBe(409);

    await call(adminToken, `/api/v1/users/${userB}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "shared-alias@example.test" }),
    });
    const clashSecondary = await call(adminToken, `/api/v1/users/${userA}/emails`, {
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

    const crossAccount = await call(adminToken, `/api/v1/users/${userA}`, {
      method: "PATCH",
      body: JSON.stringify({ email: "alias-b@example.test" }),
    });
    expect(crossAccount.status).toBe(409);

    const ownAlias = await call(adminToken, `/api/v1/users/${userA}`, {
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
    const response = await call(adminToken, `/api/v1/users/${survivorId}/merge`, {
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

    const response = await call(adminToken, `/api/v1/users/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
    expect(response.status).toBe(409);
    expect(await queryAll<{ active: number }>(env.DB, "SELECT active FROM users WHERE id = ?", sourceId)).toEqual([
      { active: 0 },
    ]);
  });

  it("does not allow magic-link login through an unverified secondary email", async () => {
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

    await call(adminToken, `/api/v1/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "alias@example.test" }),
    });

    const viaCanonical = await queueUserSignInCapability({
      db: env.DB,
      email: "canonical@example.test",
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    expect(viaCanonical?.queuedToken).toMatch(/^pkcq1_/);

    const viaAlias = await queueUserSignInCapability({
      db: env.DB,
      email: "alias@example.test",
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    expect(viaAlias).toBeNull();
  });

  it("signs a verified secondary email into the same canonical user", async () => {
    const userId = await insertUser("canonical-login@example.test");
    const staffRole = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'membership_processor'")
    )[0];
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, staffRole.id, adminId)
      .run();
    const emailId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO user_emails
         (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
       VALUES (?, ?, ?, ?, datetime('now'), 'staff', datetime('now'))`,
    )
      .bind(emailId, userId, "verified-alias@example.test", "verified-alias@example.test")
      .run();

    const issued = await queueUserSignInCapability({
      db: env.DB,
      email: "verified-alias@example.test",
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    expect(issued).toMatchObject({ identity: { id: userId, email: "canonical-login@example.test" } });
    if (!issued) throw new Error("Expected a verified-alias sign-in capability");
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(
      env.DB,
      env,
      JSON.stringify({
        magicLinkUrl: issued.queuedToken,
        __authorizedCapabilityMarkers: [issued.queuedToken],
      }),
    );
    const redeemed = await redeemUserSignInCapability(env.DB, {
      token: delivered.magicLinkUrl,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      sessionTtlHours: 8,
    });

    expect(redeemed.session.identity).toMatchObject({ id: userId, email: "canonical-login@example.test" });
    expect(redeemed.session.staff?.id).toBe(userId);
    expect(
      await queryAll<{ verified_at: string | null }>(env.DB, "SELECT verified_at FROM user_emails WHERE id = ?", [
        emailId,
      ]),
    ).toEqual([{ verified_at: expect.any(String) }]);
  });

  it("invalidates an issued alias sign-in capability when the alias is removed", async () => {
    const userId = await insertUser("alias-removal@example.test");
    const staffRole = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'membership_processor'")
    )[0];
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, staffRole.id, adminId)
      .run();
    const emailId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO user_emails
         (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
       VALUES (?, ?, ?, ?, datetime('now'), 'staff', datetime('now'))`,
    )
      .bind(emailId, userId, "removed-alias@example.test", "removed-alias@example.test")
      .run();
    const issued = await queueUserSignInCapability({
      db: env.DB,
      email: "removed-alias@example.test",
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    if (!issued) throw new Error("Expected a verified-alias sign-in capability");
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(
      env.DB,
      env,
      JSON.stringify({
        magicLinkUrl: issued.queuedToken,
        __authorizedCapabilityMarkers: [issued.queuedToken],
      }),
    );

    await env.DB.prepare("DELETE FROM user_emails WHERE id = ? AND user_id = ?").bind(emailId, userId).run();
    await expect(
      redeemUserSignInCapability(env.DB, {
        token: delivered.magicLinkUrl,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        sessionTtlHours: 8,
      }),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
  });

  it("rolls back alias sign-in when verification is revoked during redemption", async () => {
    const userId = await insertUser("alias-race@example.test");
    const staffRole = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'membership_processor'")
    )[0];
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, staffRole.id, adminId)
      .run();
    const emailId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO user_emails
         (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
       VALUES (?, ?, ?, ?, datetime('now'), 'staff', datetime('now'))`,
    )
      .bind(emailId, userId, "alias-race-verified@example.test", "alias-race-verified@example.test")
      .run();
    const issued = await queueUserSignInCapability({
      db: env.DB,
      email: "alias-race-verified@example.test",
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    if (!issued) throw new Error("Expected a verified-alias sign-in capability");
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(
      env.DB,
      env,
      JSON.stringify({
        magicLinkUrl: issued.queuedToken,
        __authorizedCapabilityMarkers: [issued.queuedToken],
      }),
    );
    const gate = gateNextBatch(env.DB);
    const redemption = redeemUserSignInCapability(gate.db, {
      token: delivered.magicLinkUrl,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      sessionTtlHours: 8,
    });
    await gate.reached;
    await env.DB.prepare("UPDATE user_emails SET verified_at = NULL, verification_method = NULL WHERE id = ?")
      .bind(emailId)
      .run();
    gate.release();

    await expect(redemption).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    expect(await queryAll(env.DB, "SELECT id FROM sessions WHERE user_id = ?", [userId])).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE actor_id = ? AND action = 'user_magic_link_verified'", [
        userId,
      ]),
    ).toHaveLength(0);
  });

  it("invalidates an issued sign-in capability when the primary email changes", async () => {
    const userId = await insertUser("change-before-link@example.test");
    const staffRole = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'membership_processor'")
    )[0];
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, staffRole.id, adminId)
      .run();

    const issued = await queueUserSignInCapability({
      db: env.DB,
      email: "change-before-link@example.test",
      ttlMinutes: 15,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    expect(issued?.queuedToken).toMatch(/^pkcq1_/);
    if (!issued) throw new Error("Expected canonical sign-in capability");
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(
      env.DB,
      env,
      JSON.stringify({
        magicLinkUrl: issued.queuedToken,
        __authorizedCapabilityMarkers: [issued.queuedToken],
      }),
    );
    const token = delivered.magicLinkUrl;

    await env.DB.prepare("UPDATE users SET email = ?, normalized_email = ?, updated_at = datetime('now') WHERE id = ?")
      .bind("changed-after-link@example.test", "changed-after-link@example.test", userId)
      .run();

    await expect(
      redeemUserSignInCapability(env.DB, {
        token,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        sessionTtlHours: 8,
      }),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
  });

  it("Users list search matches a secondary email", async () => {
    const userId = await insertUser("findme-primary@example.test");
    await call(adminToken, `/api/v1/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "findme-alias@example.test" }),
    });

    const searchResponse = await call(adminToken, "/api/v1/users?q=findme-alias");
    const results = (await searchResponse.json()) as { users: Array<{ id: string }> };
    expect(results.users.some((u) => u.id === userId)).toBe(true);
  });
});
