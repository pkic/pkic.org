import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { onRequestPatch as patchUser } from "../functions/api/v1/admin/users/[userId]/index";
import { onRequestPost as anonymizeUser } from "../functions/api/v1/admin/users/[userId]/anonymize";
import app from "../functions/router";

let adminToken: string;

async function setup() {
  await seedEventAndAdmin(env.DB);
  const adminId = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0].id;
  adminToken = await createAdminSession(env.DB, adminId, "admin-session-token");
  return { adminId, env };
}

function adminRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`https://app.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function seedUser(_db: DatabaseLike, email: string): Promise<string> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `
    INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
    VALUES (?, ?, ?, 'Test', 'User', 'user', 1, datetime('now'), datetime('now'));
  `,
  )
    .bind(userId, email, email)
    .run();
  return userId;
}

// ── Deactivation / reactivation ────────────────────────────────────────────

describe("admin user deactivation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("deactivates an active user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "target@example.test");

    const response = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: false }), { userId }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { success: boolean; user: { active: boolean } };
    expect(data.success).toBe(true);
    expect(data.user.active).toBe(false);

    const row = (await queryAll<{ active: number }>(env.DB, "SELECT active FROM users WHERE id = ?", [userId]))[0];
    expect(row.active).toBe(0);
  });

  it("reactivates a deactivated user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "inactive@example.test");
    await env.DB.prepare(`UPDATE users SET active = 0 WHERE id = '${userId}'`).run();

    const response = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: true }), { userId }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { user: { active: boolean } };
    expect(data.user.active).toBe(true);
  });

  it("can update role and active together", async () => {
    await setup();
    const userId = await seedUser(env.DB, "combo@example.test");

    const response = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { role: "guest", active: false }), {
        userId,
      }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { user: { role: string; active: boolean } };
    expect(data.user.role).toBe("guest");
    expect(data.user.active).toBe(false);
  });

  it("updates profile biography and links", async () => {
    await setup();
    const userId = await seedUser(env.DB, "profile@example.test");

    const response = await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {
          biography: "Admin maintained speaker biography.",
          links: ["https://example.test/profile", "https://github.com/profile"],
        }),
        { userId },
      ),
    );

    expect(response.status).toBe(200);
    const row = (
      await queryAll<{ biography: string | null; links_json: string | null }>(
        env.DB,
        "SELECT biography, links_json FROM users WHERE id = ?",
        [userId],
      )
    )[0];
    expect(row.biography).toBe("Admin maintained speaker biography.");
    expect(JSON.parse(row.links_json ?? "[]")).toEqual(["https://example.test/profile", "https://github.com/profile"]);
  });

  it("persists profile edits through the full router pipeline (regression: a stale duplicate PATCH route previously shadowed this handler)", async () => {
    await setup();
    const userId = await seedUser(env.DB, "router-profile@example.test");

    const response = await app.fetch(
      adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {
        firstName: "Router",
        lastName: "Tested",
        jobTitle: "QA Lead",
        biography: "Persisted via the real HTTP router, not a direct handler call.",
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const row = (
      await queryAll<{
        first_name: string | null;
        last_name: string | null;
        job_title: string | null;
        biography: string | null;
      }>(env.DB, "SELECT first_name, last_name, job_title, biography FROM users WHERE id = ?", [userId])
    )[0];
    expect(row.first_name).toBe("Router");
    expect(row.last_name).toBe("Tested");
    expect(row.job_title).toBe("QA Lead");
    expect(row.biography).toBe("Persisted via the real HTTP router, not a direct handler call.");
  });

  it("refuses to deactivate the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      patchUser(
        createContext(env, adminRequest(`/api/v1/admin/users/${adminId}`, "PATCH", { active: false }), {
          userId: adminId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("writes an audit log entry on deactivation", async () => {
    await setup();
    const userId = await seedUser(env.DB, "audit-deact@example.test");

    await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: false }), { userId }),
    );

    const entry = (
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
    )[0];
    expect(entry.action).toBe("user_updated");
  });

  it("sets and clears isEcMember (users.is_ec_member, migration 0038)", async () => {
    await setup();
    const userId = await seedUser(env.DB, "ec-member@example.test");

    const setResponse = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { isEcMember: true }), { userId }),
    );
    expect(setResponse.status).toBe(200);
    const setData = (await setResponse.json()) as { user: { isEcMember: boolean } };
    expect(setData.user.isEcMember).toBe(true);

    const rowAfterSet = (
      await queryAll<{ is_ec_member: number }>(env.DB, "SELECT is_ec_member FROM users WHERE id = ?", [userId])
    )[0];
    expect(rowAfterSet.is_ec_member).toBe(1);

    const getResponse = await app.fetch(
      adminRequest(`/api/v1/admin/users/${userId}`, "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    const getData = (await getResponse.json()) as { user: { isEcMember: boolean } };
    expect(getData.user.isEcMember).toBe(true);

    const clearResponse = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { isEcMember: false }), { userId }),
    );
    const clearData = (await clearResponse.json()) as { user: { isEcMember: boolean } };
    expect(clearData.user.isEcMember).toBe(false);

    const rowAfterClear = (
      await queryAll<{ is_ec_member: number }>(env.DB, "SELECT is_ec_member FROM users WHERE id = ?", [userId])
    )[0];
    expect(rowAfterClear.is_ec_member).toBe(0);
  });

  it("rejects an empty patch body (no fields provided)", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      patchUser(createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {}), { userId })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

// ── Anonymization ──────────────────────────────────────────────────────────

describe("admin user anonymization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("removes PII and deactivates the user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "pii-person@example.test");

    const response = await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { success: boolean; userId: string };
    expect(data.success).toBe(true);
    expect(data.userId).toBe(userId);

    const row = (
      await queryAll<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        active: number;
        pii_redacted_at: string | null;
      }>(env.DB, "SELECT email, first_name, last_name, active, pii_redacted_at FROM users WHERE id = ?", [userId])
    )[0];

    expect(row.email).toMatch(/^redacted-/);
    expect(row.first_name).toBeNull();
    expect(row.last_name).toBeNull();
    expect(row.active).toBe(0);
    expect(row.pii_redacted_at).toBeTruthy();
  });

  it("revokes all active sessions for the anonymized user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "session-holder@example.test");

    // Give the target user an active session
    await createAdminSession(env.DB, userId, "target-user-token");

    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    const sessions = await queryAll<{ revoked_at: string | null }>(
      env.DB,
      "SELECT revoked_at FROM sessions WHERE user_id = ?",
      [userId],
    );
    expect(sessions.every((s) => s.revoked_at !== null)).toBe(true);
  });

  it("refuses to anonymize an already-anonymized user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "already-anon@example.test");

    // Anonymize once
    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    // Second attempt should be rejected
    await expect(
      anonymizeUser(createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId })),
    ).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
  });

  it("refuses to anonymize the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      anonymizeUser(
        createContext(env, adminRequest(`/api/v1/admin/users/${adminId}/anonymize`, "POST"), { userId: adminId }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 404 for a non-existent user", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      anonymizeUser(createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an audit log entry on anonymization", async () => {
    await setup();
    const userId = await seedUser(env.DB, "audit-anon@example.test");

    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    const entry = (
      await queryAll<{ action: string; details_json: string }>(
        env.DB,
        "SELECT action, details_json FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
    )[0];
    expect(entry.action).toBe("user_anonymized");
    const details = JSON.parse(entry.details_json) as {
      previousEmail: { from: string | null; to: string };
    };
    expect(details.previousEmail).toEqual({ from: null, to: "audit-anon@example.test" });
  });
});
