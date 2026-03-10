import { describe, it, expect } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import {
  onRequestPatch as patchUser,
} from "../functions/api/v1/admin/users/[userId]/index";
import {
  onRequestPost as anonymizeUser,
} from "../functions/api/v1/admin/users/[userId]/anonymize";

const ADMIN_TOKEN = "admin-session-token";

async function setup() {
  const db = new D1DatabaseShim();
  db.runMigrations();
  await seedEventAndAdmin(db);
  const env = createEnv(db);
  const adminId = db.raw<{ id: string }>("SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")[0].id;
  await createAdminSession(db, adminId, ADMIN_TOKEN);
  return { db, env, adminId };
}

function adminRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`https://app.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${ADMIN_TOKEN}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function seedUser(db: D1DatabaseShim, email: string): Promise<string> {
  const userId = crypto.randomUUID();
  await db.exec?.(`
    INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
    VALUES ('${userId}', '${email}', '${email}', 'Test', 'User', 'user', 1, datetime('now'), datetime('now'));
  `);
  return userId;
}

// ── Deactivation / reactivation ────────────────────────────────────────────

describe("admin user deactivation", () => {
  it("deactivates an active user", async () => {
    const { db, env, adminId } = await setup();
    const userId = await seedUser(db, "target@example.test");

    const response = await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: false }),
        { userId },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json() as { success: boolean; user: { active: boolean } };
    expect(data.success).toBe(true);
    expect(data.user.active).toBe(false);

    const row = db.raw<{ active: number }>("SELECT active FROM users WHERE id = ?", [userId])[0];
    expect(row.active).toBe(0);
  });

  it("reactivates a deactivated user", async () => {
    const { db, env } = await setup();
    const userId = await seedUser(db, "inactive@example.test");
    await db.exec?.(`UPDATE users SET active = 0 WHERE id = '${userId}'`);

    const response = await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: true }),
        { userId },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json() as { user: { active: boolean } };
    expect(data.user.active).toBe(true);
  });

  it("can update role and active together", async () => {
    const { db, env } = await setup();
    const userId = await seedUser(db, "combo@example.test");

    const response = await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { role: "guest", active: false }),
        { userId },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json() as { user: { role: string; active: boolean } };
    expect(data.user.role).toBe("guest");
    expect(data.user.active).toBe(false);
  });

  it("refuses to deactivate the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      patchUser(
        createContext(
          env,
          adminRequest(`/api/v1/admin/users/${adminId}`, "PATCH", { active: false }),
          { userId: adminId },
        ),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("writes an audit log entry on deactivation", async () => {
    const { db, env } = await setup();
    const userId = await seedUser(db, "audit-deact@example.test");

    await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: false }),
        { userId },
      ),
    );

    const entry = db.raw<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1", [userId])[0];
    expect(entry.action).toBe("user_updated");
  });

  it("rejects an empty patch body (no fields provided)", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      patchUser(
        createContext(
          env,
          adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {}),
          { userId },
        ),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

// ── Anonymization ──────────────────────────────────────────────────────────

describe("admin user anonymization", () => {
  it("removes PII and deactivates the user", async () => {
    const { db, env } = await setup();
    const userId = await seedUser(db, "pii-person@example.test");

    const response = await anonymizeUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"),
        { userId },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json() as { success: boolean; userId: string };
    expect(data.success).toBe(true);
    expect(data.userId).toBe(userId);

    const row = db.raw<{
      email: string;
      first_name: string | null;
      last_name: string | null;
      active: number;
      pii_redacted_at: string | null;
    }>("SELECT email, first_name, last_name, active, pii_redacted_at FROM users WHERE id = ?", [userId])[0];

    expect(row.email).toMatch(/^redacted-/);
    expect(row.first_name).toBeNull();
    expect(row.last_name).toBeNull();
    expect(row.active).toBe(0);
    expect(row.pii_redacted_at).toBeTruthy();
  });

  it("revokes all active sessions for the anonymized user", async () => {
    const { db, env } = await setup();
    const userId = await seedUser(db, "session-holder@example.test");

    // Give the target user an active session
    await createAdminSession(db, userId, "target-user-token");

    await anonymizeUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"),
        { userId },
      ),
    );

    const sessions = db.raw<{ revoked_at: string | null }>("SELECT revoked_at FROM sessions WHERE user_id = ?", [userId]);
    expect(sessions.every((s) => s.revoked_at !== null)).toBe(true);
  });

  it("refuses to anonymize an already-anonymized user", async () => {
    const { db, env } = await setup();
    const userId = await seedUser(db, "already-anon@example.test");

    // Anonymize once
    await anonymizeUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"),
        { userId },
      ),
    );

    // Second attempt should be rejected
    await expect(
      anonymizeUser(
        createContext(
          env,
          adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"),
          { userId },
        ),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
  });

  it("refuses to anonymize the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      anonymizeUser(
        createContext(
          env,
          adminRequest(`/api/v1/admin/users/${adminId}/anonymize`, "POST"),
          { userId: adminId },
        ),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 404 for a non-existent user", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      anonymizeUser(
        createContext(
          env,
          adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"),
          { userId },
        ),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an audit log entry on anonymization", async () => {
    const { db, env } = await setup();
    const userId = await seedUser(db, "audit-anon@example.test");

    await anonymizeUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"),
        { userId },
      ),
    );

    const entry = db.raw<{ action: string; details_json: string }>(
      "SELECT action, details_json FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId],
    )[0];
    expect(entry.action).toBe("user_anonymized");
    const details = JSON.parse(entry.details_json) as { previousEmail: string };
    expect(details.previousEmail).toBe("audit-anon@example.test");
  });
});
