/**
 * admin-organizations.test.ts
 *
 * Fix 1 (migration 0040) — membership category becomes an organization-level
 * property (organizations.membership_category), no longer independently set
 * per representative. Covers:
 *   - GET org detail surfaces membershipCategory once at the top level, not
 *     per representative.
 *   - PATCH org membershipCategory cascades to every existing org-tied
 *     representative's members.member_type.
 *   - POST .../organizations/:id/members (add representative) inherits the
 *     org's category and rejects when the org has none set yet.
 *   - PATCH .../members/:id rejects membershipCategory for org-tied members
 *     but still allows it for org-less individual (H5/H6/H7) members.
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

function orgMemberBody(overrides: Record<string, unknown> = {}) {
  return {
    organizationName: "Acme Corp",
    membershipCategory: "F",
    memberSince: "2026-01-15",
    representatives: [{ name: "Jane Doe", email: "jane@acme.test" }],
    workingGroupSlugs: [],
    ...overrides,
  };
}

describe("Admin Organizations — org-level membership category (migration 0040, Fix 1)", () => {
  let adminToken: string;

  async function createOrg(overrides: Record<string, unknown> = {}): Promise<{
    organizationId: string;
    memberId: string;
    userId: string;
  }> {
    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(orgMemberBody(overrides)),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      organizationId: string;
      members: Array<{ id: string; userId: string }>;
    };
    return { organizationId: body.organizationId, memberId: body.members[0].id, userId: body.members[0].userId };
  }

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-orgs-token");
  });

  it("creating an organization via the Interim Admin Tool sets organizations.membership_category", async () => {
    const { organizationId } = await createOrg();

    const orgRows = await queryAll<{ membership_category: string | null }>(
      env.DB,
      "SELECT membership_category FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].membership_category).toBe("F");
  });

  it("GET org detail surfaces membershipCategory once at the top level, not per representative", async () => {
    const { organizationId } = await createOrg();

    const response = await call(adminToken, `/api/v1/admin/organizations/${organizationId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      organization: { membershipCategory: string | null; representatives: Array<Record<string, unknown>> };
    };
    expect(body.organization.membershipCategory).toBe("F");
    expect(body.organization.representatives).toHaveLength(1);
    expect(body.organization.representatives[0]).not.toHaveProperty("membershipCategory");
  });

  it("PATCH org membershipCategory cascades to every existing org-tied representative's member_type", async () => {
    const { organizationId, memberId } = await createOrg();

    // Add a second representative under the original category first.
    const addResponse = await call(adminToken, `/api/v1/admin/organizations/${organizationId}/members`, {
      method: "POST",
      body: JSON.stringify({ name: "Second Rep", email: "second@acme.test" }),
    });
    expect(addResponse.status).toBe(201);
    const added = (await addResponse.json()) as { representative: { memberId: string } };

    const patchResponse = await call(adminToken, `/api/v1/admin/organizations/${organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "G" }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { organization: { membershipCategory: string | null } };
    expect(patched.organization.membershipCategory).toBe("G");

    const memberRows = await queryAll<{ id: string; member_type: string }>(
      env.DB,
      "SELECT id, member_type FROM members WHERE organization_id = ? ORDER BY created_at ASC",
      organizationId,
    );
    expect(memberRows).toHaveLength(2);
    expect(memberRows.find((m) => m.id === memberId)?.member_type).toBe("G");
    expect(memberRows.find((m) => m.id === added.representative.memberId)?.member_type).toBe("G");
  });

  it("adding a representative inherits the organization's current category", async () => {
    const { organizationId } = await createOrg({ membershipCategory: "B" });

    const response = await call(adminToken, `/api/v1/admin/organizations/${organizationId}/members`, {
      method: "POST",
      body: JSON.stringify({ name: "New Rep", email: "newrep@acme.test", jobTitle: "Engineer" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { representative: { memberId: string } };
    expect(body.representative).not.toHaveProperty("membershipCategory");

    const memberRows = await queryAll<{ member_type: string }>(
      env.DB,
      "SELECT member_type FROM members WHERE id = ?",
      body.representative.memberId,
    );
    expect(memberRows[0].member_type).toBe("B");
  });

  it("rejects adding a representative when the organization has no category set yet", async () => {
    const { organizationId } = await createOrg();
    // Simulate a pre-migration organization that never got a category backfilled.
    await env.DB.prepare("UPDATE organizations SET membership_category = NULL WHERE id = ?").bind(organizationId).run();

    const response = await call(adminToken, `/api/v1/admin/organizations/${organizationId}/members`, {
      method: "POST",
      body: JSON.stringify({ name: "No Category Rep", email: "nocategory@acme.test" }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORG_CATEGORY_NOT_SET");
  });

  it("rejects membershipCategory on PATCH .../members/:id for an org-tied representative", async () => {
    const { memberId } = await createOrg();

    const response = await call(adminToken, `/api/v1/admin/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "H5" }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MEMBERSHIP_CATEGORY_NOT_EDITABLE");
  });

  it("still allows other fields (status, showOnOrgProfile) to be edited on an org-tied representative", async () => {
    const { memberId } = await createOrg();

    const response = await call(adminToken, `/api/v1/admin/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "inactive", showOnOrgProfile: false }),
    });
    expect(response.status).toBe(200);

    const memberRows = await queryAll<{ status: string; show_on_org_profile: number }>(
      env.DB,
      "SELECT status, show_on_org_profile FROM members WHERE id = ?",
      memberId,
    );
    expect(memberRows[0].status).toBe("inactive");
    expect(memberRows[0].show_on_org_profile).toBe(0);
  });

  it("org-less individual (H5/H6/H7) category remains independently editable via PATCH .../members/:id", async () => {
    const response = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          organizationName: undefined,
          membershipCategory: "H6",
          representatives: [{ name: "Solo Consultant", email: "solo-cat@example.test" }],
        }),
      ),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { members: Array<{ id: string; organizationId: string | null }> };
    expect(created.members[0].organizationId).toBeNull();

    const patchResponse = await call(adminToken, `/api/v1/admin/members/${created.members[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "H7" }),
    });
    expect(patchResponse.status).toBe(200);

    const memberRows = await queryAll<{ member_type: string; organization_id: string | null }>(
      env.DB,
      "SELECT member_type, organization_id FROM members WHERE id = ?",
      created.members[0].id,
    );
    expect(memberRows[0].member_type).toBe("H7");
    expect(memberRows[0].organization_id).toBeNull();
  });

  it("reusing an existing organization with a different category cascades to its prior representatives too", async () => {
    const { organizationId, memberId } = await createOrg({ membershipCategory: "C" });

    // Re-submit the Interim Admin Tool with the same org name but a
    // different category and a different representative — this exercises
    // the "reuse an existing organization" branch of createAdminMember.
    const secondResponse = await call(adminToken, "/api/v1/admin/members", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          membershipCategory: "D",
          representatives: [{ name: "Later Rep", email: "later@acme.test" }],
        }),
      ),
    });
    expect(secondResponse.status).toBe(201);
    const secondBody = (await secondResponse.json()) as { organizationId: string };
    expect(secondBody.organizationId).toBe(organizationId);

    const orgRows = await queryAll<{ membership_category: string | null }>(
      env.DB,
      "SELECT membership_category FROM organizations WHERE id = ?",
      organizationId,
    );
    expect(orgRows[0].membership_category).toBe("D");

    const memberRows = await queryAll<{ member_type: string }>(
      env.DB,
      "SELECT member_type FROM members WHERE id = ?",
      memberId,
    );
    expect(memberRows[0].member_type).toBe("D");
  });
});
