/**
 * working-groups.test.ts
 *
 * Admin working-groups CRUD + membership management — the admin-only
 * complement to the public GET /api/v1/working-groups[/:id] and the member
 * self-service POST/DELETE /api/v1/me/working-groups/:wgId. Covers
 * create/list/update/deactivate, add/remove member (including the
 * CA-category constraint), and permission denial.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { isIndividualMembershipCategory } from "../assets/shared/schemas/membership-categories";
import { insertOrganization, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";

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

async function insertMember(userId: string, membershipCategory: string): Promise<void> {
  if (isIndividualMembershipCategory(membershipCategory)) {
    const { statements } = buildCreateIndividualMemberStatements(
      env.DB,
      userId,
      membershipCategory,
      new Date().toISOString(),
    );
    await env.DB.batch(statements);
    return;
  }
  const orgId = await insertOrganization(env.DB);
  const memberId = await seedOrganizationAggregate(env.DB, orgId, membershipCategory);
  await addRepresentative(env.DB, memberId, userId);
}

async function insertWorkingGroup(name: string, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, slug)
    .run();
  return id;
}

async function assignRole(userId: string, roleId: string, grantedBy: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, grantedBy)
    .run();
}

describe("admin working groups", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-wg-token");
  });

  it("creates a working group and lists it (including inactive groups, unlike the public endpoint)", async () => {
    const createResponse = await call(adminToken, "/api/v1/admin/working-groups", {
      method: "POST",
      body: JSON.stringify({ name: "Test Working Group", description: "for tests" }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { workingGroup: { id: string; slug: string; active: boolean } };
    expect(created.workingGroup.slug).toBe("test-working-group");
    expect(created.workingGroup.active).toBe(true);

    const listResponse = await call(adminToken, "/api/v1/admin/working-groups");
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { workingGroups: Array<{ id: string }> };
    expect(list.workingGroups.some((g) => g.id === created.workingGroup.id)).toBe(true);
  });

  it("creating a working group with a duplicate name returns 409", async () => {
    await call(adminToken, "/api/v1/admin/working-groups", {
      method: "POST",
      body: JSON.stringify({ name: "Duplicate WG" }),
    });
    const second = await call(adminToken, "/api/v1/admin/working-groups", {
      method: "POST",
      body: JSON.stringify({ name: "Duplicate WG" }),
    });
    expect(second.status).toBe(409);
  });

  it("updates a working group's fields and can deactivate/reactivate it", async () => {
    const createResponse = await call(adminToken, "/api/v1/admin/working-groups", {
      method: "POST",
      body: JSON.stringify({ name: "Editable WG" }),
    });
    const created = (await createResponse.json()) as { workingGroup: { id: string } };

    const patchResponse = await call(adminToken, `/api/v1/admin/working-groups/${created.workingGroup.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "updated", active: false }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { workingGroup: { description: string; active: boolean } };
    expect(patched.workingGroup.description).toBe("updated");
    expect(patched.workingGroup.active).toBe(false);

    const reactivate = await call(adminToken, `/api/v1/admin/working-groups/${created.workingGroup.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
    expect(((await reactivate.json()) as { workingGroup: { active: boolean } }).workingGroup.active).toBe(true);
  });

  it("adds and removes a member from a working group", async () => {
    const wgId = await insertWorkingGroup("Test PQC", "test-pqc");
    const userId = await insertUser("wg-member@example.test");

    const addResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    expect(addResponse.status).toBe(201);

    const detailResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}`);
    const detail = (await detailResponse.json()) as { workingGroup: { members: Array<{ userId: string }> } };
    expect(detail.workingGroup.members.some((m) => m.userId === userId)).toBe(true);

    const removeResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members/${userId}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(200);

    const afterRemove = (await (await call(adminToken, `/api/v1/admin/working-groups/${wgId}`)).json()) as {
      workingGroup: { members: Array<{ userId: string }> };
    };
    expect(afterRemove.workingGroup.members.some((m) => m.userId === userId)).toBe(false);
  });

  it("rejects adding a non-category-A member to the CA working group", async () => {
    const wgId = await insertWorkingGroup("CA Working Group", "ca");
    const userId = await insertUser("non-ca-member@example.test");
    await insertMember(userId, "F");

    const response = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    expect(response.status).toBe(403);
  });

  it("allows adding a category-A member to the CA working group", async () => {
    const wgId = await insertWorkingGroup("CA Working Group", "ca");
    const userId = await insertUser("ca-member@example.test");
    await insertMember(userId, "A");

    const response = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    expect(response.status).toBe(201);
  });

  // ── Fix 2: chair / vice chair via user_roles (migration 0040) ────────────

  async function findRoleId(name: string): Promise<string> {
    const rows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = ?", name);
    return rows[0].id;
  }

  it("GET working group detail/list surfaces the current chair and vice chair resolved from user_roles", async () => {
    const wgId = await insertWorkingGroup("Chaired WG", "chaired-wg");
    const chairUserId = await insertUser("chair@example.test");
    const viceChairUserId = await insertUser("vice-chair@example.test");
    const chairRoleId = await findRoleId("wg_chair");
    const viceChairRoleId = await findRoleId("wg_vice_chair");

    await call(adminToken, `/api/v1/admin/users/${chairUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: chairRoleId, contextType: "working_group", contextId: wgId }),
    });
    await call(adminToken, `/api/v1/admin/users/${viceChairUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: viceChairRoleId, contextType: "working_group", contextId: wgId }),
    });

    const detailResponse = await call(adminToken, `/api/v1/admin/working-groups/${wgId}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      workingGroup: {
        chair: { userId: string; userRoleId: string } | null;
        viceChair: { userId: string; userRoleId: string } | null;
      };
    };
    expect(detail.workingGroup.chair?.userId).toBe(chairUserId);
    expect(detail.workingGroup.viceChair?.userId).toBe(viceChairUserId);

    const listResponse = await call(adminToken, "/api/v1/admin/working-groups");
    const list = (await listResponse.json()) as {
      workingGroups: Array<{ id: string; chair: { userId: string } | null; viceChair: { userId: string } | null }>;
    };
    const listed = list.workingGroups.find((g) => g.id === wgId);
    expect(listed?.chair?.userId).toBe(chairUserId);
    expect(listed?.viceChair?.userId).toBe(viceChairUserId);
  });

  it("removing a chair (DELETE user_roles/:userRoleId) clears it from the working group detail", async () => {
    const wgId = await insertWorkingGroup("Removable Chair WG", "removable-chair-wg");
    const chairUserId = await insertUser("removable-chair@example.test");
    const chairRoleId = await findRoleId("wg_chair");

    const assignResponse = await call(adminToken, `/api/v1/admin/users/${chairUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: chairRoleId, contextType: "working_group", contextId: wgId }),
    });
    const assigned = (await assignResponse.json()) as { role: { id: string } };

    const beforeRemove = (await (await call(adminToken, `/api/v1/admin/working-groups/${wgId}`)).json()) as {
      workingGroup: { chair: { userId: string } | null };
    };
    expect(beforeRemove.workingGroup.chair?.userId).toBe(chairUserId);

    const removeResponse = await call(adminToken, `/api/v1/admin/users/${chairUserId}/roles/${assigned.role.id}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(200);

    const afterRemove = (await (await call(adminToken, `/api/v1/admin/working-groups/${wgId}`)).json()) as {
      workingGroup: { chair: { userId: string } | null };
    };
    expect(afterRemove.workingGroup.chair).toBeNull();
  });

  it("PATCH user_roles/:userRoleId changes a chair's expiry, including assigning one that was never set", async () => {
    const wgId = await insertWorkingGroup("Expiry Edit WG", "expiry-edit-wg");
    const chairUserId = await insertUser("expiry-edit-chair@example.test");
    const chairRoleId = await findRoleId("wg_chair");

    const assignResponse = await call(adminToken, `/api/v1/admin/users/${chairUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: chairRoleId, contextType: "working_group", contextId: wgId }),
    });
    const assigned = (await assignResponse.json()) as { role: { id: string; expiresAt: string | null } };
    expect(assigned.role.expiresAt).toBeNull();

    const newExpiry = "2027-01-01T00:00:00.000Z";
    const patchResponse = await call(adminToken, `/api/v1/admin/users/${chairUserId}/roles/${assigned.role.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expiresAt: newExpiry }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { role: { expiresAt: string | null } };
    expect(patched.role.expiresAt).toBe(newExpiry);

    const detail = (await (await call(adminToken, `/api/v1/admin/working-groups/${wgId}`)).json()) as {
      workingGroup: { chair: { expiresAt: string | null } | null };
    };
    expect(detail.workingGroup.chair?.expiresAt).toBe(newExpiry);

    const clearResponse = await call(adminToken, `/api/v1/admin/users/${chairUserId}/roles/${assigned.role.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expiresAt: null }),
    });
    expect(clearResponse.status).toBe(200);
    const cleared = (await clearResponse.json()) as { role: { expiresAt: string | null } };
    expect(cleared.role.expiresAt).toBeNull();
  });

  it("chair and vice chair are independent — assigning one doesn't affect the other", async () => {
    const wgId = await insertWorkingGroup("Independent Roles WG", "independent-roles-wg");
    const chairUserId = await insertUser("independent-chair@example.test");
    const chairRoleId = await findRoleId("wg_chair");

    await call(adminToken, `/api/v1/admin/users/${chairUserId}/roles`, {
      method: "POST",
      body: JSON.stringify({ roleId: chairRoleId, contextType: "working_group", contextId: wgId }),
    });

    const detail = (await (await call(adminToken, `/api/v1/admin/working-groups/${wgId}`)).json()) as {
      workingGroup: { chair: { userId: string } | null; viceChair: { userId: string } | null };
    };
    expect(detail.workingGroup.chair?.userId).toBe(chairUserId);
    expect(detail.workingGroup.viceChair).toBeNull();
  });

  it("a staff user without working-groups:write cannot create or modify working groups", async () => {
    const staffId = await insertUser("staff-no-wg-perm@example.test");
    await assignRole(staffId, "role-membership_processor", adminId);
    const staffToken = await createAdminSession(env.DB, staffId, "staff-no-wg-perm-token");

    const response = await call(staffToken, "/api/v1/admin/working-groups", {
      method: "POST",
      body: JSON.stringify({ name: "Should Not Be Created" }),
    });
    expect(response.status).toBe(403);
  });
});
