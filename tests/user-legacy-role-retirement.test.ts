import { signJwt } from "../functions/_lib/utils/jwt";
import { signMcpSessionToken, verifyMcpSessionToken } from "../functions/_lib/auth/mcp-session";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStaffSessionActor } from "../functions/_lib/auth/user-session-result";
import { hasPermission } from "../functions/_lib/auth/permissions";
import { findEligibleStaffUserById } from "../functions/_lib/auth/identity-capacities";
import { userUpdateSchema } from "../assets/shared/schemas/user-management";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

describe("access-control authority", () => {
  it("does not turn a legacy administrator label into staff authority", async () => {
    const id = await insertUser(env.DB, "legacy-administrator@example.test");
    expect(await findEligibleStaffUserById(env.DB, id)).toBeNull();
    await expect(env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run()).rejects.toThrow(
      "no such column: role",
    );
    expect(
      hasPermission(
        Object.assign(
          { identityType: "user" as const, id, email: "legacy-administrator@example.test" },
          { role: "admin" },
        ),
        "users:write",
      ),
    ).toBe(false);
    expect(userUpdateSchema.safeParse({ firstName: "Ada", role: "admin" }).success).toBe(false);
  });

  it("resolves only live grants without transporting a legacy account label", async () => {
    const id = await insertUser(env.DB, "legacy-metadata@example.test");
    await env.DB.prepare("INSERT INTO permission_grants (id, user_id, permission, created_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, "users:read", new Date().toISOString())
      .run();
    const staff = await findEligibleStaffUserById(env.DB, id);
    expect(staff).not.toBeNull();
    const actor = await createStaffSessionActor(env.DB, staff!, "session", "2027-01-01T00:00:00.000Z", null);
    expect(actor).not.toHaveProperty("role");
    expect(hasPermission(actor, "users:read")).toBe(true);
    expect(hasPermission(actor, "users:write")).toBe(false);
    expect(await env.DB.prepare("PRAGMA table_info(users)").all()).not.toMatchObject({
      results: expect.arrayContaining([expect.objectContaining({ name: "role" })]),
    });
  });

  it("issues role-free MCP credentials and refuses stale human role claims", async () => {
    const claims = {
      sub: "synthetic-user",
      sid: "synthetic-session",
      email: "mcp@example.test",
      scopes: ["users:read"],
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    const secret = "synthetic-mcp-signing-secret";
    const current = await verifyMcpSessionToken(secret, await signMcpSessionToken(secret, claims));
    expect(current).toMatchObject({ ok: true });
    if (current.ok) expect(current.claims).not.toHaveProperty("role");
    const stale = await signJwt(secret, { typ: "mcp-session", ...claims, role: "admin" });
    expect(await verifyMcpSessionToken(secret, stale)).toEqual({ ok: false, reason: "invalid" });
  });

  it("grants and revokes access to forms, organizations, and users through assignments", async () => {
    const id = await insertUser(env.DB, "access-administrator@example.test");
    await grantAdministrator(env.DB, id);
    const token = await createAdminSession(env.DB, id, "access-control-retirement-test");
    const headers = { authorization: `Bearer ${token}` };
    const session = await callApi(env, "/api/v1/auth/session", { headers });
    expect(session.status).toBe(200);
    expect((await session.json<{ staff: object }>()).staff).not.toHaveProperty("role");
    for (const resource of ["forms", "organizations", "users"]) {
      const response = await callApi(env, `/api/v1/${resource}?limit=1`, { headers });
      expect(response.status, `${resource}: ${await response.clone().text()}`).toBe(200);
    }
    await env.DB.prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ?")
      .bind(new Date().toISOString(), id)
      .run();
    // Neither the session nor a legacy label can restore revoked authority.
    expect(await findEligibleStaffUserById(env.DB, id)).toBeNull();
    const denied = await callApi(env, "/api/v1/users?limit=1", { headers });
    expect([401, 403]).toContain(denied.status);
  });
});
