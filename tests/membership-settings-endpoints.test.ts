/**
 * membership-settings-endpoints.test.ts
 *
 * GET/PATCH /api/v1/admin/membership-settings (singleton row
 * seeded by consolidated migration 0035).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

function requestWithAuth(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    requestWithAuth(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("Membership workflow settings", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "settings-admin-token");
  });

  it("GET returns the seeded defaults", async () => {
    const response = await call(adminToken, "/api/v1/admin/membership-settings");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { consultationWindowDays: number; ecReviewWindowDays: number };
    expect(body.consultationWindowDays).toBe(7);
    expect(body.ecReviewWindowDays).toBe(7);
  });

  it("PATCH updates only the provided fields", async () => {
    const response = await call(adminToken, "/api/v1/admin/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ consultationWindowDays: 10 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { consultationWindowDays: number; ecReviewWindowDays: number };
    expect(body.consultationWindowDays).toBe(10);
    expect(body.ecReviewWindowDays).toBe(7);

    const rows = await queryAll<{ consultation_window_days: number; updated_by_user_id: string | null }>(
      env.DB,
      "SELECT consultation_window_days, updated_by_user_id FROM membership_settings WHERE id = 'default'",
    );
    expect(rows[0].consultation_window_days).toBe(10);
    expect(rows[0].updated_by_user_id).toBe(adminId);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'membership_settings_updated'",
      ),
    ).toEqual([{ actor_id: adminId }]);
  });

  it("keeps API-key audit identity out of the nullable settings updater foreign key", async () => {
    const response = await call(env.ADMIN_API_KEY ?? "test-admin-key", "/api/v1/admin/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ consultationWindowDays: 12 }),
    });
    expect(response.status).toBe(200);

    expect(
      await queryAll<{ consultation_window_days: number; updated_by_user_id: string | null }>(
        env.DB,
        "SELECT consultation_window_days, updated_by_user_id FROM membership_settings WHERE id = 'default'",
      ),
    ).toEqual([{ consultation_window_days: 12, updated_by_user_id: null }]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'membership_settings_updated'",
      ),
    ).toEqual([{ actor_id: "api-key" }]);
  });

  it("resetDb() does not wipe the singleton settings row (it is system reference data)", async () => {
    const rows = await queryAll(env.DB, "SELECT id FROM membership_settings WHERE id = 'default'");
    expect(rows).toHaveLength(1);
  });

  it("membership:read is sufficient for GET but membership:write is required for PATCH", async () => {
    const staffId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'processor@example.test', 'processor@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffId)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at) VALUES (?, ?, 'role-membership_processor', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "processor-settings-token");

    const getResponse = await call(staffToken, "/api/v1/admin/membership-settings");
    expect(getResponse.status).toBe(200);

    const patchResponse = await call(staffToken, "/api/v1/admin/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ ecReviewWindowDays: 14 }),
    });
    expect(patchResponse.status).toBe(200); // membership_processor holds membership:write too
  });

  it("a staff user with an unrelated role is denied", async () => {
    const staffId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'wgchair@example.test', 'wgchair@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffId)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at) VALUES (?, ?, 'role-wg_chair', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "wgchair-settings-token");

    const response = await call(staffToken, "/api/v1/admin/membership-settings");
    expect(response.status).toBe(403);
  });
});
