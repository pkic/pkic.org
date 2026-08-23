import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

function callInternal(path: string, token: string, body: Record<string, unknown> = {}): Promise<Response> {
  return callApi(env, path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createScopedStaffToken(eventId: string): Promise<string> {
  const staffId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'scoped-internal@example.test', 'scoped-internal@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(staffId),
    env.DB.prepare(
      `INSERT INTO permission_grants
           (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
         VALUES (?, ?, 'admin:write', 'event', ?, NULL, datetime('now'))`,
    ).bind(crypto.randomUUID(), staffId, eventId),
  ]);
  return createAdminSession(env.DB, staffId, "scoped-internal-token");
}

describe("internal operations authorization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it.each([
    "/api/v1/internal/email/retry",
    "/api/v1/internal/email/reset-failed",
    "/api/v1/internal/jobs/run",
    "/api/v1/internal/reminders/run",
    "/api/v1/internal/retention/run",
  ])("denies event-scoped staff at the mounted %s route", async (path) => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const response = await callInternal(path, await createScopedStaffToken(eventId));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PERMISSION_REQUIRED" } });
  });

  it("allows the service API key to run a harmless mounted jobs pass", async () => {
    await seedEventAndAdmin(env.DB);
    const response = await callInternal("/api/v1/internal/jobs/run", env.ADMIN_API_KEY ?? "test-admin-key", {
      runReminders: false,
      runRetention: false,
      runOutbox: false,
      dryRun: true,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, dryRun: true });
  });

  it.each(["api key", "global admin"])("allows the %s to run the mounted retention route", async (actor) => {
    await seedEventAndAdmin(env.DB);
    const token =
      actor === "api key"
        ? (env.ADMIN_API_KEY ?? "test-admin-key")
        : await createAdminSession(
            env.DB,
            (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0].id,
            "internal-retention-admin-token",
          );

    const response = await callInternal("/api/v1/internal/retention/run", token);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, affectedEvents: 0 });
  });
});
