/**
 * organization-management.test.ts
 *
 * Phase 1 §1.4 corrected design — membership category lives once per
 * membership aggregate (member_category_assignments), not on
 * `organizations` and not per-representative. Covers:
 *   - GET org detail surfaces membershipCategory once at the top level, not
 *     per representative.
 *   - PATCH org membershipCategory updates the aggregate's single category
 *     assignment (no "cascade to every representative" — there's only ever
 *     one category per aggregate now).
 *   - POST .../organizations/:organizationId/representatives inherits the
 *     org's category and rejects when the org has none set yet.
 *   - PATCH .../members/:id rejects membershipCategory/status for a
 *     representative id (those live on the aggregate now) but still allows
 *     showOnOrgProfile, and still allows membershipCategory for an org-less
 *     individual (H5/H6/H7) member id.
 *   - Reusing an existing organization with a *different* category is a
 *     409 conflict (getOrCreateOrganizationMemberAggregate), not a silent
 *     cascade-update.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { organizationsListResponseSchema } from "../assets/shared/schemas/organization-management";

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
    name: "Acme Corp",
    membershipCategory: "F",
    memberSince: "2026-01-15",
    representatives: [{ name: "Jane Doe", email: "jane@acme.test" }],
    workingGroupSlugs: [],
    ...overrides,
  };
}

describe("Organization management — membership category on the aggregate (Phase 1 §1.4)", () => {
  let adminToken: string;
  let adminId: string;

  /** memberId is the representative's organization_representatives primary key. */
  async function createOrg(overrides: Record<string, unknown> = {}): Promise<{
    organizationId: string;
    memberId: string;
    userId: string;
    revision: string;
  }> {
    const response = await call(adminToken, "/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(orgMemberBody(overrides)),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      organization: {
        id: string;
        updatedAt: string;
        representatives: Array<{ representativeId: string; userId: string }>;
      };
    };
    return {
      organizationId: body.organization.id,
      memberId: body.organization.representatives[0].representativeId,
      userId: body.organization.representatives[0].userId,
      revision: body.organization.updatedAt,
    };
  }

  async function addRepresentative(
    organizationId: string,
    input: { name: string; email: string; jobTitle?: string; links?: string[] },
  ): Promise<string> {
    const response = await call(adminToken, `/api/v1/organizations/${organizationId}/representatives`, {
      method: "POST",
      body: JSON.stringify({ kind: "email", ...input, showOnOrganizationProfile: true }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { representativeId: string }).representativeId;
  }

  async function aggregateIdFor(organizationId: string): Promise<string> {
    const rows = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM members WHERE organization_id = ?",
      organizationId,
    );
    return rows[0].id;
  }

  async function categoryFor(memberId: string): Promise<string | null> {
    const rows = await queryAll<{ category_code: string }>(
      env.DB,
      "SELECT category_code FROM member_category_assignments WHERE member_id = ?",
      memberId,
    );
    return rows[0]?.category_code ?? null;
  }

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-orgs-token");
  });

  it("creating an organization sets its aggregate's category assignment", async () => {
    const { organizationId, userId } = await createOrg();
    const aggregateId = await aggregateIdFor(organizationId);
    expect(await categoryFor(aggregateId)).toBe("F");
    expect(
      await queryAll<{ granted_by_user_id: string | null }>(
        env.DB,
        `SELECT granted_by_user_id FROM user_roles
         WHERE user_id = ? AND context_type = 'organization' AND context_id = ? AND role_id = 'role-primary_contact'`,
        [userId, aggregateId],
      ),
    ).toEqual([{ granted_by_user_id: adminId }]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'organization_created' AND entity_id = ?",
        organizationId,
      ),
    ).toEqual([{ actor_id: adminId }]);
  });

  it("GET org detail surfaces membershipCategory once at the top level, not per representative", async () => {
    const { organizationId } = await createOrg();

    const response = await call(adminToken, `/api/v1/organizations/${organizationId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      organization: { membershipCategory: string | null; representatives: Array<Record<string, unknown>> };
    };
    expect(body.organization.membershipCategory).toBe("F");
    expect(body.organization.representatives).toHaveLength(1);
    expect(body.organization.representatives[0]).not.toHaveProperty("membershipCategory");
  });

  it("does not surface a stale primary-contact grant after the representative leaves", async () => {
    const { organizationId, userId } = await createOrg();
    const aggregateId = await aggregateIdFor(organizationId);
    await env.DB.prepare(
      "UPDATE organization_representatives SET left_at = joined_at WHERE member_id = ? AND user_id = ?",
    )
      .bind(aggregateId, userId)
      .run();

    const detailResponse = await call(adminToken, `/api/v1/organizations/${organizationId}`);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      organization: {
        primaryContactEmail: null,
        primaryContactUserId: null,
        representatives: [],
      },
    });

    const listResponse = await call(adminToken, "/api/v1/organizations");
    const listBody = (await listResponse.json()) as {
      organizations: Array<{ id: string; primaryContactEmail: string | null }>;
    };
    expect(listBody.organizations.find((organization) => organization.id === organizationId)?.primaryContactEmail).toBe(
      null,
    );
  });

  it("keeps list and detail primary-contact fields aligned for every active-grant state", async () => {
    const { organizationId, userId } = await createOrg();
    const aggregateId = await aggregateIdFor(organizationId);

    async function expectPrimaryContact(email: string | null, expectedUserId: string | null) {
      const detailResponse = await call(adminToken, `/api/v1/organizations/${organizationId}`);
      expect(detailResponse.status).toBe(200);
      await expect(detailResponse.json()).resolves.toMatchObject({
        organization: { primaryContactEmail: email, primaryContactUserId: expectedUserId },
      });

      const listResponse = await call(adminToken, "/api/v1/organizations");
      const listBody = (await listResponse.json()) as {
        organizations: Array<{ id: string; primaryContactEmail: string | null }>;
      };
      expect(
        listBody.organizations.find((organization) => organization.id === organizationId)?.primaryContactEmail,
      ).toBe(email);
    }

    await expectPrimaryContact("jane@acme.test", userId);

    await env.DB.prepare(
      "UPDATE user_roles SET expires_at = datetime('now', '-1 minute') WHERE context_id = ? AND user_id = ? AND role_id = 'role-primary_contact'",
    )
      .bind(aggregateId, userId)
      .run();
    await expectPrimaryContact(null, null);

    await env.DB.prepare(
      "UPDATE user_roles SET expires_at = NULL, revoked_at = datetime('now') WHERE context_id = ? AND user_id = ? AND role_id = 'role-primary_contact'",
    )
      .bind(aggregateId, userId)
      .run();
    await expectPrimaryContact(null, null);

    await env.DB.prepare(
      "UPDATE user_roles SET revoked_at = NULL WHERE context_id = ? AND user_id = ? AND role_id = 'role-primary_contact'",
    )
      .bind(aggregateId, userId)
      .run();
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(userId).run();
    await expectPrimaryContact(null, null);

    await env.DB.prepare("UPDATE users SET active = 1 WHERE id = ?").bind(userId).run();
    await env.DB.prepare(
      "UPDATE organization_representatives SET left_at = joined_at WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
    )
      .bind(aggregateId, userId)
      .run();
    await expectPrimaryContact(null, null);
  });

  it("GET organizations list surfaces membershipCategory and supports ?sort=", async () => {
    const acme = await createOrg({ name: "Acme Corp", membershipCategory: "F" });
    const beta = await createOrg({
      name: "Beta Inc",
      membershipCategory: "A",
      representatives: [{ name: "Bob Beta", email: "bob@beta.test" }],
    });

    const listResponse = await call(adminToken, "/api/v1/organizations");
    expect(listResponse.status).toBe(200);
    const listBody = organizationsListResponseSchema.parse(await listResponse.json());
    const byName = Object.fromEntries(listBody.organizations.map((o) => [o.name, o.membershipCategory]));
    expect(byName["Acme Corp"]).toBe("F");
    expect(byName["Beta Inc"]).toBe("A");
    const contactsById = Object.fromEntries(
      listBody.organizations.map((organization) => [organization.id, organization.primaryContactEmail]),
    );
    expect(contactsById[acme.organizationId]).toBe("jane@acme.test");
    expect(contactsById[beta.organizationId]).toBe("bob@beta.test");

    const sortedResponse = await call(adminToken, "/api/v1/organizations?sort=membership_category");
    const sortedBody = organizationsListResponseSchema.parse(await sortedResponse.json());
    const categories = sortedBody.organizations.map((o) => o.membershipCategory);
    expect(categories).toEqual([...categories].sort());
  });

  it("creating an organization sets member_since on the aggregate", async () => {
    const { organizationId } = await createOrg();
    const aggregateId = await aggregateIdFor(organizationId);

    const memberRows = await queryAll<{ member_since: string | null }>(
      env.DB,
      "SELECT member_since FROM members WHERE id = ?",
      aggregateId,
    );
    expect(memberRows[0].member_since).toBe("2026-01-15");

    const response = await call(adminToken, `/api/v1/organizations/${organizationId}`);
    const body = (await response.json()) as { organization: { memberSince: string } };
    expect(body.organization.memberSince).toBe("2026-01-15");
  });

  it("PATCH org memberSince updates the aggregate's stored value", async () => {
    const { organizationId, revision } = await createOrg();
    const aggregateId = await aggregateIdFor(organizationId);

    const response = await call(adminToken, `/api/v1/organizations/${organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({ memberSince: "2020-03-01", revision }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { organization: { memberSince: string } };
    expect(body.organization.memberSince).toBe("2020-03-01");

    const memberRows = await queryAll<{ member_since: string }>(
      env.DB,
      "SELECT member_since FROM members WHERE id = ?",
      aggregateId,
    );
    expect(memberRows[0].member_since).toBe("2020-03-01");
  });

  it("PATCH org membershipCategory updates the aggregate's single category assignment", async () => {
    const { organizationId, revision } = await createOrg();

    // Add a second representative under the original category first — both
    // representatives share the same aggregate, so there's nothing
    // per-representative to cascade to.
    await addRepresentative(organizationId, { name: "Second Rep", email: "second@acme.test" });

    const patchResponse = await call(adminToken, `/api/v1/organizations/${organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "G", revision }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { organization: { membershipCategory: string | null } };
    expect(patched.organization.membershipCategory).toBe("G");

    const aggregateId = await aggregateIdFor(organizationId);
    expect(await categoryFor(aggregateId)).toBe("G");

    const repCount = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM organization_representatives WHERE member_id = ? AND left_at IS NULL",
      aggregateId,
    );
    expect(Number(repCount[0].total)).toBe(2);
  });

  it("adding a representative inherits the organization's current category", async () => {
    const { organizationId } = await createOrg({ membershipCategory: "B" });

    const links = ["https://github.com/newrep", "https://orcid.org/0000-0001-2345-6789"];
    const representativeId = await addRepresentative(organizationId, {
      name: "New Rep",
      email: "newrep@acme.test",
      jobTitle: "Engineer",
      links,
    });

    const repRows = await queryAll<{ member_id: string }>(
      env.DB,
      "SELECT member_id FROM organization_representatives WHERE id = ?",
      representativeId,
    );
    expect(await categoryFor(repRows[0].member_id)).toBe("B");

    const detailResponse = await call(adminToken, `/api/v1/organizations/${organizationId}`);
    const detail = (await detailResponse.json()) as {
      organization: { representatives: Array<{ email: string; links: string[] }> };
    };
    expect(detail.organization.representatives.find((rep) => rep.email === "newrep@acme.test")?.links).toEqual(links);
  });

  it("rejects adding a representative when the organization has no category set yet", async () => {
    // A bare organization row created outside the Interim Admin Tool flow —
    // no members aggregate, and therefore no category, exists for it yet.
    const organizationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
    )
      .bind(organizationId, "No Category Org", "no category org")
      .run();

    const response = await call(adminToken, `/api/v1/organizations/${organizationId}/representatives`, {
      method: "POST",
      body: JSON.stringify({
        kind: "email",
        name: "No Category Rep",
        email: "nocategory@acme.test",
        showOnOrganizationProfile: true,
      }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORG_CATEGORY_NOT_SET");
  });

  it("rejects membershipCategory and status on PATCH .../members/:id for a representative id — those live on the aggregate", async () => {
    const { memberId } = await createOrg();

    const categoryResponse = await call(adminToken, `/api/v1/admin/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "H5" }),
    });
    expect(categoryResponse.status).toBe(422);
    expect(((await categoryResponse.json()) as { error: { code: string } }).error.code).toBe(
      "REPRESENTATIVE_FIELD_NOT_EDITABLE",
    );

    const statusResponse = await call(adminToken, `/api/v1/admin/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "inactive" }),
    });
    expect(statusResponse.status).toBe(422);
    expect(((await statusResponse.json()) as { error: { code: string } }).error.code).toBe(
      "REPRESENTATIVE_FIELD_NOT_EDITABLE",
    );
  });

  it("still allows showOnOrgProfile to be edited on a representative id", async () => {
    const { memberId } = await createOrg();

    const response = await call(adminToken, `/api/v1/admin/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ showOnOrgProfile: false }),
    });
    expect(response.status).toBe(200);

    const repRows = await queryAll<{ show_on_org_profile: number }>(
      env.DB,
      "SELECT show_on_org_profile FROM organization_representatives WHERE id = ?",
      memberId,
    );
    expect(repRows[0].show_on_org_profile).toBe(0);
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
    expect(memberRows[0].member_type).toBe("individual");
    expect(memberRows[0].organization_id).toBeNull();
    expect(await categoryFor(created.members[0].id)).toBe("H7");
  });

  it("reusing an existing organization with a different category is a 409 conflict, not a silent cascade", async () => {
    const { organizationId } = await createOrg({ membershipCategory: "C" });
    const aggregateId = await aggregateIdFor(organizationId);

    const secondResponse = await call(adminToken, "/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          membershipCategory: "D",
          representatives: [{ name: "Later Rep", email: "later@acme.test" }],
        }),
      ),
    });
    expect(secondResponse.status).toBe(409);
    expect(((await secondResponse.json()) as { error: { code: string } }).error.code).toBe("MEMBER_CATEGORY_CONFLICT");

    // The conflicting attempt must not have mutated the existing category.
    expect(await categoryFor(aggregateId)).toBe("C");
  });

  it("reusing an existing organization with the SAME category succeeds and adds the new representative", async () => {
    const { organizationId } = await createOrg({ membershipCategory: "C" });

    const secondResponse = await call(adminToken, "/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          membershipCategory: "C",
          representatives: [{ name: "Later Rep", email: "later@acme.test" }],
        }),
      ),
    });
    expect(secondResponse.status).toBe(201);
    const secondBody = (await secondResponse.json()) as { organization: { id: string } };
    expect(secondBody.organization.id).toBe(organizationId);

    const aggregateId = await aggregateIdFor(organizationId);
    const repCount = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM organization_representatives WHERE member_id = ? AND left_at IS NULL",
      aggregateId,
    );
    expect(Number(repCount[0].total)).toBe(2);
  });
});
