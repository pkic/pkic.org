import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { permissionTargetsListResponseSchema } from "../assets/shared/schemas/access-control";
import { userCatalogListResponseSchema } from "../assets/shared/schemas/user-catalog";
import { createGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin } from "../functions/_lib/types";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

function call(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

describe("Permission subjects and targets", () => {
  let adminId: string;
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0].id;
    adminToken = await createAdminSession(env.DB, adminId, `system-catalog-${crypto.randomUUID()}`);
  });

  it("returns a bounded, data-minimized active user catalog and rejects API keys", async () => {
    const activeId = crypto.randomUUID();
    const inactiveId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, role, active, created_at, updated_at)
           VALUES (?, 'ada.catalog@example.test', 'ada.catalog@example.test', 'Ada', 'Lovelace', 'Analytical Engines', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(activeId),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
           VALUES (?, 'inactive.catalog@example.test', 'inactive.catalog@example.test', 'user', 0, datetime('now'), datetime('now'))`,
      ).bind(inactiveId),
    ]);

    const response = await call(adminToken, "/api/v1/permissions/subjects?q=ada.catalog&limit=1&sort=email");
    expect(response.status).toBe(200);
    const payload = userCatalogListResponseSchema.parse(await response.json());
    expect(payload.users).toEqual([
      {
        id: activeId,
        email: "ada.catalog@example.test",
        first_name: "Ada",
        last_name: "Lovelace",
        organization_name: "Analytical Engines",
      },
    ]);
    expect(payload.page).toEqual({
      limit: 1,
      offset: 0,
      total: 1,
      hasMore: false,
    });
    expect(Object.keys(payload.users[0]).sort()).toEqual([
      "email",
      "first_name",
      "id",
      "last_name",
      "organization_name",
    ]);

    expect((await call(adminToken, "/api/v1/permissions/subjects?limit=9&q=ada")).status).toBe(400);
    expect((await call(adminToken, "/api/v1/permissions/subjects?sort=role&q=ada")).status).toBe(400);
    expect((await call(env.ADMIN_API_KEY ?? "test-admin-key", "/api/v1/permissions/subjects?q=ada")).status).toBe(403);
    expect((await callApi(env, "/api/v1/permissions/subjects?q=ada")).status).toBe(401);
  });

  it("permits a revoke-only user-backed operator to read every permission and role read model", async () => {
    const operatorId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
           VALUES (?, 'revoke-reader@example.test', 'revoke-reader@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(operatorId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, 'access:revoke', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), operatorId, adminId),
    ]);
    const token = await createAdminSession(env.DB, operatorId, `revoke-reader-${crypto.randomUUID()}`);

    for (const path of [
      "/api/v1/permissions/grants",
      "/api/v1/roles",
      "/api/v1/roles/role-admin/assignments",
      `/api/v1/users/${operatorId}/roles`,
      "/api/v1/permissions/subjects?q=revoke-reader",
      "/api/v1/permissions/targets?contextType=event&q=PQC",
    ]) {
      expect((await call(token, path)).status, path).toBe(200);
    }
  });

  it("does not retain the generic system route family", async () => {
    expect((await call(adminToken, "/api/v1/system")).status).toBe(404);
    expect((await call(adminToken, "/api/v1/system/access-control/grants")).status).toBe(404);
  });

  it("lists only requested durable context types with D1 search, ordering, and pagination", async () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
    };
    const group = await createGroup(env.DB, actor, {
      typeKey: "working_group",
      name: "Catalog Group",
    });
    const organizationId = await insertOrganization(env.DB, "Context Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);

    const events = permissionTargetsListResponseSchema.parse(
      await (await call(adminToken, "/api/v1/permissions/targets?contextType=event&q=PQC&limit=1")).json(),
    );
    expect(events.targets).toEqual([{ id: expect.any(String), type: "event", name: "PQC Conference 2026" }]);
    expect(events.page).toEqual({
      limit: 1,
      offset: 0,
      total: 1,
      hasMore: false,
    });

    const groups = permissionTargetsListResponseSchema.parse(
      await (await call(adminToken, "/api/v1/permissions/targets?contextType=group&q=Catalog&sort=name")).json(),
    );
    expect(groups.targets).toEqual([{ id: group.id, type: "group", name: "Catalog Group" }]);

    const organizations = permissionTargetsListResponseSchema.parse(
      await (
        await call(adminToken, "/api/v1/permissions/targets?contextType=organization&q=Context%20Organization&limit=1")
      ).json(),
    );
    expect(organizations.targets).toEqual([{ id: memberId, type: "organization", name: "Context Organization" }]);
    expect(organizations.page).toEqual({
      limit: 1,
      offset: 0,
      total: 1,
      hasMore: false,
    });

    expect((await call(adminToken, "/api/v1/permissions/targets?contextType=event&limit=51")).status).toBe(400);
    expect((await call(adminToken, "/api/v1/permissions/targets?contextType=event&sort=id")).status).toBe(400);
  });
});
