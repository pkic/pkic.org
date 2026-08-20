/**
 * admin-members.test.ts
 *
 * "Interim Admin Tool — Manual Member Management" —
 * POST/GET /api/v1/admin/members, gated by the existing `membership:write`
 * permission (held by `admin` and `membership_processor` roles).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

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

async function assignRole(userId: string, roleId: string, grantedBy: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, grantedBy)
    .run();
}

async function seedWorkingGroup(slug: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 1, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), name, slug)
    .run();
}

function orgMemberBody(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: "Acme Corp",
    website: "https://acme.test",
    description: "A test organization",
    membershipCategory: "F",
    memberSince: "2026-01-15",
    representatives: [
      {
        name: "Jane Doe",
        email: "jane@acme.test",
        role: "CTO",
        links: ["https://linkedin.com/in/janedoe", "https://github.com/janedoe"],
      },
    ],
    workingGroupSlugs: ["pqc"],
    ...overrides,
  };
}

describe("Interim Admin Tool — POST/GET /api/v1/admin/members", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-members-token");
    await seedWorkingGroup("pqc", "Post-Quantum Cryptography Working Group");
    await seedWorkingGroup("cm", "Cryptographic Module Working Group");
  });

  it("creates an organization, representative, and member row for an org-tied category", async () => {
    await seedWorkingGroup("future-wg", "Future Working Group");
    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody({ workingGroupSlugs: ["pqc", "future-wg"] })),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { organizationId: string; members: Array<{ id: string; userId: string }> };
    expect(body.organizationId).toBeTruthy();
    expect(body.members).toHaveLength(1);

    const orgRows = await queryAll<{ name: string }>(
      env.DB,
      "SELECT name FROM organizations WHERE id = ?",
      body.organizationId,
    );
    expect(orgRows[0].name).toBe("Acme Corp");

    const aggregateRows = await queryAll<{ id: string; member_type: string; status: string; member_since: string }>(
      env.DB,
      "SELECT id, member_type, status, member_since FROM members WHERE organization_id = ?",
      body.organizationId,
    );
    expect(aggregateRows).toHaveLength(1);
    expect(aggregateRows[0].member_type).toBe("organization");
    expect(aggregateRows[0].status).toBe("active");
    // Regression guard: createAdminMember used to accept `memberSince` in the
    // request but never write it anywhere (migration 0049 added the column,
    // now on `members`, not `organizations`).
    expect(aggregateRows[0].member_since).toBe("2026-01-15");

    const categoryRows = await queryAll<{ category_code: string }>(
      env.DB,
      "SELECT category_code FROM member_category_assignments WHERE member_id = ?",
      aggregateRows[0].id,
    );
    expect(categoryRows[0].category_code).toBe("F");

    const primaryContactRows = await queryAll<{ user_id: string }>(
      env.DB,
      `SELECT user_id FROM user_roles WHERE context_type = 'organization' AND context_id = ? AND role_id = 'role-primary_contact' AND revoked_at IS NULL`,
      aggregateRows[0].id,
    );
    expect(primaryContactRows[0].user_id).toBe(body.members[0].userId);

    // body.members[0].id is this representative's own organization_representatives.id
    // (see admin-organizations.ts's toOrgDetail comment) — not the shared aggregate id.
    const repRows = await queryAll<{ show_on_org_profile: number; left_at: string | null }>(
      env.DB,
      "SELECT show_on_org_profile, left_at FROM organization_representatives WHERE id = ?",
      body.members[0].id,
    );
    expect(repRows[0].show_on_org_profile).toBe(1);
    expect(repRows[0].left_at).toBeNull();

    const [user] = await queryAll<{ links_json: string | null }>(
      env.DB,
      "SELECT links_json FROM users WHERE id = ?",
      body.members[0].userId,
    );
    expect(JSON.parse(user.links_json as string)).toEqual([
      "https://linkedin.com/in/janedoe",
      "https://github.com/janedoe",
    ]);

    const wgRows = await queryAll<{ slug: string }>(
      env.DB,
      "SELECT wg.slug FROM working_group_members wgm JOIN working_groups wg ON wg.id = wgm.working_group_id WHERE wgm.user_id = ? ORDER BY wg.slug",
      body.members[0].userId,
    );
    expect(wgRows.map(({ slug }) => slug)).toEqual(["future-wg", "pqc"]);
  });

  it("creates no organization row for an individual (H6) category", async () => {
    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          organizationName: undefined,
          membershipCategory: "H6",
          representatives: [{ name: "Solo Consultant", email: "solo@example.test" }],
        }),
      ),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      organizationId: string | null;
      members: Array<{ organizationId: string | null }>;
    };
    expect(body.organizationId).toBeNull();
    expect(body.members[0].organizationId).toBeNull();

    const orgCount = await queryAll(env.DB, "SELECT id FROM organizations");
    expect(orgCount).toHaveLength(0);
  });

  it("rejects an individual category with an organization name", async () => {
    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody({ membershipCategory: "H6" })),
    });
    expect(response.status).toBe(400);
  });

  it("reuses an existing organization when the normalized name already exists", async () => {
    const first = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody()),
    });
    const firstBody = (await first.json()) as { organizationId: string };

    const second = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody({ representatives: [{ name: "Second Rep", email: "second@acme.test" }] })),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { organizationId: string };
    expect(secondBody.organizationId).toBe(firstBody.organizationId);

    const orgRows = await queryAll(env.DB, "SELECT id FROM organizations WHERE id = ?", firstBody.organizationId);
    expect(orgRows).toHaveLength(1);
  });

  it("assigns primary and secondary contact from the first two representatives in one submission", async () => {
    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          representatives: [
            { name: "Jane Doe", email: "jane@acme.test" },
            { name: "Second Rep", email: "second@acme.test" },
          ],
        }),
      ),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { organizationId: string; members: Array<{ userId: string }> };

    const aggregateRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM members WHERE organization_id = ?", body.organizationId)
    )[0];
    const roleRows = await queryAll<{ role_id: string; user_id: string }>(
      env.DB,
      `SELECT role_id, user_id FROM user_roles
       WHERE context_type = 'organization' AND context_id = ? AND revoked_at IS NULL
         AND role_id IN ('role-primary_contact', 'role-secondary_contact')`,
      aggregateRow.id,
    );
    const primaryContact = roleRows.find((r) => r.role_id === "role-primary_contact");
    const secondaryContact = roleRows.find((r) => r.role_id === "role-secondary_contact");
    expect(primaryContact?.user_id).toBe(body.members[0].userId);
    expect(secondaryContact?.user_id).toBe(body.members[1].userId);
  });

  it("returns 409 when the same email is already an active representative of this exact organization", async () => {
    await call(adminToken, "/api/v1/admin/members", { method: "POST", body: JSON.stringify(orgMemberBody()) });

    // Reusing the same organization (same normalized name) with the same
    // representative email is a duplicate-representative conflict.
    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody()),
    });
    expect(response.status).toBe(409);
  });

  it("does not conflict when the same person represents a different organization (multi-org representation is allowed)", async () => {
    await call(adminToken, "/api/v1/admin/members", { method: "POST", body: JSON.stringify(orgMemberBody()) });

    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody({ organizationName: "Other Corp" })),
    });
    expect(response.status).toBe(201);

    const orgRows = await queryAll(env.DB, "SELECT id FROM organizations WHERE normalized_name = 'other corp'");
    expect(orgRows).toHaveLength(1);
  });

  it("lists created members unfiltered by status", async () => {
    await call(adminToken, "/api/v1/admin/members", { method: "POST", body: JSON.stringify(orgMemberBody()) });

    const response = await call(adminToken, "/api/v1/admin/members");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { members: Array<{ email: string }>; page: { total: number } };
    expect(body.page.total).toBe(1);
    expect(body.members[0].email).toBe("jane@acme.test");
  });

  it("membership_processor role (non-admin) can create and list members", async () => {
    const staffId = await insertUser("staff-membership@example.test");
    await assignRole(staffId, "role-membership_processor", adminId);
    const staffToken = await createAdminSession(env.DB, staffId, "staff-membership-token");

    const createResponse = await call(staffToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody()),
    });
    expect(createResponse.status).toBe(201);

    const listResponse = await call(staffToken, "/api/v1/admin/members");
    expect(listResponse.status).toBe(200);
  });

  it("a staff user holding an unrelated role (wg_chair) is denied membership:write", async () => {
    const staffId = await insertUser("wg-chair-only@example.test");
    await assignRole(staffId, "role-wg_chair", adminId);
    const staffToken = await createAdminSession(env.DB, staffId, "staff-wg-chair-token");

    const response = await call(staffToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody()),
    });
    expect(response.status).toBe(403);
  });

  it("a plain user with no staff-eligible role cannot even obtain access (401)", async () => {
    const staffId = await insertUser("no-permission@example.test");
    const staffToken = await createAdminSession(env.DB, staffId, "staff-no-permission-token");

    const response = await call(staffToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody()),
    });
    expect(response.status).toBe(401);
  });
});
