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
import { workingGroupsListResponseSchema } from "../assets/shared/schemas/working-groups";

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

    const migrationSeededId = "8cf09d26de5d49f3b065d60e177d5451";
    await env.DB.prepare(
      `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
       VALUES (?, 'Migration Seeded Group', 'migration-seeded-group', NULL, NULL, 1, datetime('now'), datetime('now'))`,
    )
      .bind(migrationSeededId)
      .run();

    const listResponse = await call(adminToken, "/api/v1/admin/working-groups");
    expect(listResponse.status).toBe(200);
    const list = workingGroupsListResponseSchema.parse(await listResponse.json());
    expect(list.workingGroups.some((g) => g.id === created.workingGroup.id)).toBe(true);
    expect(list.workingGroups.some((g) => g.id === migrationSeededId)).toBe(true);
    expect(list.page.total).toBeGreaterThanOrEqual(1);

    const filtered = workingGroupsListResponseSchema.parse(
      await (await call(adminToken, "/api/v1/admin/working-groups?q=Test%20Working&limit=1&sort=-name")).json(),
    );
    expect(filtered.workingGroups.map((group) => group.id)).toEqual([created.workingGroup.id]);
    expect(filtered.page).toMatchObject({ limit: 1, offset: 0, total: 1, hasMore: false });
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

  it("records member_id on the working_group_members row when the target has exactly one active membership (PR #1 review blocker 2)", async () => {
    const wgId = await insertWorkingGroup("Test PQC 2", "test-pqc-2");
    const userId = await insertUser("single-membership@example.test");
    await insertMember(userId, "F");

    const response = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    expect(response.status).toBe(201);

    const [rep] = await queryAll<{ member_id: string }>(
      env.DB,
      "SELECT member_id FROM organization_representatives WHERE user_id = ?",
      userId,
    );
    const [wgm] = await queryAll<{ member_id: string | null }>(
      env.DB,
      "SELECT member_id FROM working_group_members WHERE working_group_id = ? AND user_id = ?",
      wgId,
      userId,
    );
    expect(wgm!.member_id).toBe(rep!.member_id);
  });

  it("leaves member_id null on the working_group_members row when the target holds more than one active membership (no unambiguous context)", async () => {
    const wgId = await insertWorkingGroup("Test PQC 3", "test-pqc-3");
    const userId = await insertUser("multi-membership@example.test");
    const orgIdA = await insertOrganization(env.DB, "Multi-Org A");
    const memberIdA = await seedOrganizationAggregate(env.DB, orgIdA, "F");
    await addRepresentative(env.DB, memberIdA, userId);
    const orgIdB = await insertOrganization(env.DB, "Multi-Org B");
    const memberIdB = await seedOrganizationAggregate(env.DB, orgIdB, "F");
    await addRepresentative(env.DB, memberIdB, userId);

    const response = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    expect(response.status).toBe(201);

    const [wgm] = await queryAll<{ member_id: string | null }>(
      env.DB,
      "SELECT member_id FROM working_group_members WHERE working_group_id = ? AND user_id = ?",
      wgId,
      userId,
    );
    expect(wgm!.member_id).toBeNull();
  });

  it("deterministically allows a person representing both a category-A and a non-A organization (not an arbitrary pick)", async () => {
    // PR #1 review, phase1-2-review-20260817.md blocker 2: the CA
    // eligibility check previously used an unordered scalar subquery, so a
    // person representing more than one organization (a supported case
    // since migration 0037) could be accepted or rejected depending on
    // whichever row SQLite happened to return. Run this several times —
    // a flaky pass/fail pattern is exactly what the old bug would produce.
    const wgId = await insertWorkingGroup("CA Working Group", "ca");
    const userId = await insertUser("multi-org-member@example.test");

    const nonAOrgId = await insertOrganization(env.DB);
    const nonAMemberId = await seedOrganizationAggregate(env.DB, nonAOrgId, "F");
    await addRepresentative(env.DB, nonAMemberId, userId);

    const aOrgId = await insertOrganization(env.DB);
    const aMemberId = await seedOrganizationAggregate(env.DB, aOrgId, "A");
    await addRepresentative(env.DB, aMemberId, userId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      expect(response.status).toBe(201);
      await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members/${userId}`, { method: "DELETE" });
    }
  });

  it("deterministically rejects a person who represents only non-A organizations, across multiple affiliations", async () => {
    const wgId = await insertWorkingGroup("CA Working Group", "ca");
    const userId = await insertUser("multi-non-a-member@example.test");

    const orgOneId = await insertOrganization(env.DB);
    const memberOneId = await seedOrganizationAggregate(env.DB, orgOneId, "F");
    await addRepresentative(env.DB, memberOneId, userId);

    const orgTwoId = await insertOrganization(env.DB);
    const memberTwoId = await seedOrganizationAggregate(env.DB, orgTwoId, "G");
    await addRepresentative(env.DB, memberTwoId, userId);

    const response = await call(adminToken, `/api/v1/admin/working-groups/${wgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    expect(response.status).toBe(403);
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

  // ── Phase 4 item 2: WG chair contextual permission on add/remove member ──
  // A role-wg_chair grant is scoped to {type: "working_group", id}, and
  // hasPermission rejects a contextual grant when no context is supplied.
  // These assert the working-groups/:id/** subtree gate
  // (requireWorkingGroupAccess in working-groups/[id]/router.ts) actually
  // resolves and passes that context, rather than calling requirePermission
  // with no context like the sibling handlers used to.

  async function assignWgChair(userId: string, wgId: string): Promise<void> {
    const chairRoleId = await findRoleId("wg_chair");
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, 'working_group', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, chairRoleId, wgId, adminId)
      .run();
  }

  it("a WG chair (context-scoped working-groups:write) can add and remove a member on their own working group", async () => {
    const wgId = await insertWorkingGroup("Chair-Managed WG", "chair-managed-wg");
    const chairUserId = await insertUser("chair-manages-own@example.test");
    await assignWgChair(chairUserId, wgId);
    const chairToken = await createAdminSession(env.DB, chairUserId, "chair-manages-own-token");

    const targetUserId = await insertUser("chair-added-member@example.test");

    const addResponse = await call(chairToken, `/api/v1/admin/working-groups/${wgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId: targetUserId }),
    });
    expect(addResponse.status).toBe(201);

    const removeResponse = await call(chairToken, `/api/v1/admin/working-groups/${wgId}/members/${targetUserId}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(200);
  });

  it("a WG chair scoped to a different working group cannot add or remove a member on this one", async () => {
    const ownWgId = await insertWorkingGroup("Chair's Own WG", "chairs-own-wg");
    const otherWgId = await insertWorkingGroup("Other WG", "other-wg");
    const chairUserId = await insertUser("chair-other-wg@example.test");
    await assignWgChair(chairUserId, ownWgId);
    const chairToken = await createAdminSession(env.DB, chairUserId, "chair-other-wg-token");

    const targetUserId = await insertUser("not-added-member@example.test");

    const addResponse = await call(chairToken, `/api/v1/admin/working-groups/${otherWgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId: targetUserId }),
    });
    expect(addResponse.status).toBe(403);

    // Seed the member directly (bypassing the API) so removal has something
    // to act on, and confirm the chair still can't remove it via the API.
    await call(adminToken, `/api/v1/admin/working-groups/${otherWgId}/members`, {
      method: "POST",
      body: JSON.stringify({ userId: targetUserId }),
    });
    const removeResponse = await call(chairToken, `/api/v1/admin/working-groups/${otherWgId}/members/${targetUserId}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(403);
  });
});
