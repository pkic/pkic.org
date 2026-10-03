import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
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
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
    expect(await findEligibleStaffUserById(env.DB, id)).toBeNull();
    expect(
      hasPermission(
        { identityType: "user", id, email: "legacy-administrator@example.test", role: "admin" },
        "users:write",
      ),
    ).toBe(false);
    expect(userUpdateSchema.safeParse({ firstName: "Ada", role: "admin" }).success).toBe(false);
  });

  it("grants and revokes access to forms, organizations, and users through assignments", async () => {
    const id = await insertUser(env.DB, "access-administrator@example.test");
    await grantAdministrator(env.DB, id);
    const token = await createAdminSession(env.DB, id, "access-control-retirement-test");
    const headers = { authorization: `Bearer ${token}` };
    for (const resource of ["forms", "organizations", "users"]) {
      const response = await callApi(env, `/api/v1/${resource}?limit=1`, { headers });
      expect(response.status, `${resource}: ${await response.clone().text()}`).toBe(200);
    }
    await env.DB.prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ?")
      .bind(new Date().toISOString(), id)
      .run();
    // A stale legacy label cannot restore the revoked authority.
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
    expect(await findEligibleStaffUserById(env.DB, id)).toBeNull();
    const denied = await callApi(env, "/api/v1/users?limit=1", { headers });
    expect([401, 403]).toContain(denied.status);
  });
});
