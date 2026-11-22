/**
 * Access control keeps working when the database holds something this version
 * does not expect: a role permission written by a newer version (a shared
 * preview database, or production after a rollback), and a second assignment
 * of a role a person already holds.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

const UNKNOWN_PERMISSION = "future:permission";

let adminToken: string;
let adminId: string;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${adminToken}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, new Request(`https://app.test${path}`, { ...init, headers }));
}

async function createRoleWithUnknownPermission(): Promise<{ id: string; updatedAt: string }> {
  const created = await call("/api/v1/roles", {
    method: "POST",
    body: JSON.stringify({
      name: `desk_helper_${crypto.randomUUID().slice(0, 8).replace(/-/g, "_")}`,
      permissions: ["events:read"],
    }),
  });
  expect(created.status).toBe(201);
  const { role } = (await created.json()) as { role: { id: string; updatedAt: string } };
  await env.DB.prepare(
    "INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES (?, ?, ?, datetime('now'))",
  )
    .bind(crypto.randomUUID(), role.id, UNKNOWN_PERMISSION)
    .run();
  return role;
}

beforeEach(async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1"))[0]
    .id;
  adminToken = await createAdminSession(env.DB, adminId, "admin-unknown-permission-token");
});

describe("a stored role permission this version does not know", () => {
  it("is left out of the roles that are read, instead of failing the list", async () => {
    const role = await createRoleWithUnknownPermission();

    const list = await call("/api/v1/roles?limit=100");
    expect(list.status).toBe(200);
    const { roles } = (await list.json()) as { roles: { id: string; permissions: string[] }[] };
    expect(roles.find((item) => item.id === role.id)?.permissions).toEqual(["events:read"]);

    const one = await call(`/api/v1/roles/${role.id}`);
    expect(one.status).toBe(200);
  });

  it("survives an edit of the role's permissions", async () => {
    const role = await createRoleWithUnknownPermission();
    const updated = await call(`/api/v1/roles/${role.id}`, {
      method: "PATCH",
      body: JSON.stringify({ permissions: ["events:read", "groups:read"], revision: role.updatedAt }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { role: { permissions: string[] } }).role.permissions).toEqual([
      "events:read",
      "groups:read",
    ]);
    const stored = await queryAll<{ permission: string }>(
      env.DB,
      "SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission",
      [role.id],
    );
    expect(stored.map((row) => row.permission)).toEqual(["events:read", UNKNOWN_PERMISSION, "groups:read"]);
  });
});

describe("assigning a role a person already holds", () => {
  it("is refused with a plain message, not a server error", async () => {
    const created = await call("/api/v1/roles", {
      method: "POST",
      body: JSON.stringify({
        name: `desk_helper_${crypto.randomUUID().slice(0, 8).replace(/-/g, "_")}`,
        permissions: ["events:read"],
      }),
    });
    const { role } = (await created.json()) as { role: { id: string } };
    const assign = () =>
      call(`/api/v1/users/${adminId}/roles`, { method: "POST", body: JSON.stringify({ roleId: role.id }) });

    expect((await assign()).status).toBe(201);
    const again = await assign();
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      error: { code: "USER_ROLE_EXISTS", message: "This person already has this role for this target." },
    });
  });
});
