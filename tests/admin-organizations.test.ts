/**
 * organization-management.test.ts
 *
 * Phase 1 §1.4 corrected design — membership category lives once per
 * membership aggregate (member_category_assignments), not on
 * `organizations` and not per identity. Covers:
 *   - GET org detail surfaces membershipCategory once at the top level, not
 *     per identity.
 *   - PATCH org membershipCategory updates the aggregate's single category
 *     assignment (no "cascade to every identity" — there's only ever
 *     one category per aggregate now).
 *   - POST .../organizations/:organizationId/identities inherits the
 *     org's category and rejects when the org has none set yet.
 *   - PATCH .../members/:id rejects membershipCategory/status for a
 *     organization identity id (those live on the aggregate now) but still allows
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
    identities: [{ name: "Jane Doe", email: "jane@acme.test" }],
    workingGroupSlugs: [],
    activationReason: "Verified staff provisioning fixture",
    ...overrides,
  };
}

describe("Organization management — membership category on the aggregate (Phase 1 §1.4)", () => {
  let adminToken: string;
  let adminId: string;

  /** memberId is the acting identity primary key returned by the management response. */
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
    expect(response.status, await response.clone().text()).toBe(201);
    const body = (await response.json()) as {
      organization: {
        id: string;
        updatedAt: string;
        identities: Array<{ identityId: string; userId: string }>;
      };
    };
    return {
      organizationId: body.organization.id,
      memberId: body.organization.identities[0].identityId,
      userId: body.organization.identities[0].userId,
      revision: body.organization.updatedAt,
    };
  }

  async function addIdentity(
    organizationId: string,
    input: { name: string; email: string; jobTitle?: string; links?: string[] },
  ): Promise<string> {
    const response = await call(adminToken, `/api/v1/organizations/${organizationId}/identities`, {
      method: "POST",
      body: JSON.stringify({
        userReference: "email",
        ...input,
        showOnOrganizationProfile: true,
        activation: { mode: "immediate", reason: "Verified staff test fixture" },
      }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { identityId: string }).identityId;
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

  it("GET org detail surfaces membershipCategory once at the top level, not per identity", async () => {
    const { organizationId } = await createOrg();

    const response = await call(adminToken, `/api/v1/organizations/${organizationId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      organization: { membershipCategory: string | null; identities: Array<Record<string, unknown>> };
    };
    expect(body.organization.membershipCategory).toBe("F");
    expect(body.organization.identities).toHaveLength(1);
    expect(body.organization.identities[0]).not.toHaveProperty("membershipCategory");
  });

  it("does not surface a stale primary-contact grant after the identity ends", async () => {
    const { organizationId, userId } = await createOrg();
    await env.DB.prepare("UPDATE identities SET ended_at = started_at WHERE organization_id = ? AND user_id = ?")
      .bind(organizationId, userId)
      .run();

    const detailResponse = await call(adminToken, `/api/v1/organizations/${organizationId}`);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      organization: {
        primaryContactEmail: null,
        primaryContactUserId: null,
        identities: [],
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
      "UPDATE identities SET ended_at = started_at WHERE organization_id = ? AND user_id = ? AND ended_at IS NULL",
    )
      .bind(organizationId, userId)
      .run();
    await expectPrimaryContact(null, null);
  });

  it("GET organizations list surfaces membershipCategory and supports ?sort=", async () => {
    const acme = await createOrg({ name: "Acme Corp", membershipCategory: "F" });
    const beta = await createOrg({
      name: "Beta Inc",
      membershipCategory: "A",
      identities: [{ name: "Bob Beta", email: "bob@beta.test" }],
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

  it("rejects one person holding both contact roles, in one request or across two", async () => {
    const { organizationId, userId, revision } = await createOrg();

    const bothAtOnce = await call(adminToken, `/api/v1/organizations/${organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({ primaryContactUserId: userId, secondaryContactUserId: userId, revision }),
    });
    expect(bothAtOnce.status).toBe(400);
    await expect(bothAtOnce.json()).resolves.toMatchObject({ error: { code: "CONTACT_ROLES_MUST_DIFFER" } });

    const primaryOnly = await call(adminToken, `/api/v1/organizations/${organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({ primaryContactUserId: userId, revision }),
    });
    expect(primaryOnly.status, await primaryOnly.clone().text()).toBe(200);
    const updated = (await primaryOnly.json()) as { organization: { updatedAt: string } };

    // The retained primary role must block a colliding secondary update.
    const collidingSecondary = await call(adminToken, `/api/v1/organizations/${organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({ secondaryContactUserId: userId, revision: updated.organization.updatedAt }),
    });
    expect(collidingSecondary.status).toBe(400);
    await expect(collidingSecondary.json()).resolves.toMatchObject({
      error: { code: "CONTACT_ROLES_MUST_DIFFER" },
    });
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

    // Both active identities share the same Member aggregate, so there is no
    // identity-specific category to cascade.
    await addIdentity(organizationId, { name: "Second Rep", email: "second@acme.test" });

    const patchResponse = await call(adminToken, `/api/v1/organizations/${organizationId}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "G", revision }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = (await patchResponse.json()) as { organization: { membershipCategory: string | null } };
    expect(patched.organization.membershipCategory).toBe("G");

    expect(await categoryFor(await aggregateIdFor(organizationId))).toBe("G");

    const identityCount = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM identities WHERE organization_id = ? AND ended_at IS NULL",
      organizationId,
    );
    expect(Number(identityCount[0].total)).toBe(2);
  });

  it("adding an identity inherits the organization's current category", async () => {
    const { organizationId } = await createOrg({ membershipCategory: "B" });

    const links = ["https://github.com/newrep", "https://orcid.org/0000-0001-2345-6789"];
    const identityId = await addIdentity(organizationId, {
      name: "New Rep",
      email: "newrep@acme.test",
      jobTitle: "Engineer",
      links,
    });

    const capacityRows = await queryAll<{ member_id: string }>(
      env.DB,
      "SELECT member_id FROM identity_member_capacities WHERE identity_id = ?",
      identityId,
    );
    expect(await categoryFor(capacityRows[0].member_id)).toBe("B");

    const detailResponse = await call(adminToken, `/api/v1/organizations/${organizationId}`);
    const detail = (await detailResponse.json()) as {
      organization: { identities: Array<{ email: string; links: string[] }> };
    };
    expect(detail.organization.identities.find((identity) => identity.email === "newrep@acme.test")?.links).toEqual(
      links,
    );
  });

  it("rejects adding an identity when the organization has no category set yet", async () => {
    // A bare organization row created outside the membership provisioning flow —
    // no members aggregate, and therefore no category, exists for it yet.
    const organizationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
    )
      .bind(organizationId, "No Category Org", "no category org")
      .run();

    const response = await call(adminToken, `/api/v1/organizations/${organizationId}/identities`, {
      method: "POST",
      body: JSON.stringify({
        userReference: "email",
        name: "No Category Rep",
        email: "nocategory@acme.test",
        showOnOrganizationProfile: true,
        activation: { mode: "immediate", reason: "Verified staff test fixture" },
      }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORG_CATEGORY_NOT_SET");
  });

  it("rejects membershipCategory and status on an organization identity — those live on the aggregate", async () => {
    const { memberId } = await createOrg();

    const categoryResponse = await call(adminToken, `/api/v1/members/capacities/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "H5" }),
    });
    expect(categoryResponse.status).toBe(422);
    expect(((await categoryResponse.json()) as { error: { code: string } }).error.code).toBe(
      "IDENTITY_AGGREGATE_FIELD_NOT_EDITABLE",
    );

    const statusResponse = await call(adminToken, `/api/v1/members/capacities/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "inactive" }),
    });
    expect(statusResponse.status).toBe(422);
    expect(((await statusResponse.json()) as { error: { code: string } }).error.code).toBe(
      "IDENTITY_AGGREGATE_FIELD_NOT_EDITABLE",
    );
  });

  it("still allows showOnOrgProfile to be edited on an organization identity", async () => {
    const { memberId } = await createOrg();

    const response = await call(adminToken, `/api/v1/members/capacities/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ showOnOrgProfile: false }),
    });
    expect(response.status).toBe(200);

    const identityRows = await queryAll<{ show_on_organization_profile: number }>(
      env.DB,
      "SELECT show_on_organization_profile FROM identities WHERE id = ?",
      memberId,
    );
    expect(identityRows[0].show_on_organization_profile).toBe(0);
  });

  it("org-less individual (H5/H6/H7) category remains independently editable via PATCH .../members/:id", async () => {
    const response = await call(adminToken, "/api/v1/members", {
      method: "POST",
      body: JSON.stringify({
        membershipCategory: "H6",
        memberSince: "2026-01-15",
        identities: [{ name: "Solo Consultant", email: "solo-cat@example.test" }],
        workingGroupSlugs: [],
        activationReason: "Verified staff provisioning fixture",
      }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { members: Array<{ id: string; organizationId: string | null }> };
    expect(created.members[0].organizationId).toBeNull();

    const patchResponse = await call(adminToken, `/api/v1/members/capacities/${created.members[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "H7" }),
    });
    expect(patchResponse.status).toBe(200);

    const memberRows = await queryAll<{ id: string; member_type: string; organization_id: string | null }>(
      env.DB,
      `SELECT member.id, member.member_type, member.organization_id
         FROM identity_member_capacities capacity
         JOIN members member ON member.id = capacity.member_id
        WHERE capacity.identity_id = ?`,
      created.members[0].id,
    );
    expect(memberRows[0].member_type).toBe("individual");
    expect(memberRows[0].organization_id).toBeNull();
    expect(await categoryFor(memberRows[0].id)).toBe("H7");
  });

  it("reusing an existing organization with a different category is a 409 conflict, not a silent cascade", async () => {
    const { organizationId } = await createOrg({ membershipCategory: "C" });
    const aggregateId = await aggregateIdFor(organizationId);

    const secondResponse = await call(adminToken, "/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          membershipCategory: "D",
          identities: [{ name: "Later Rep", email: "later@acme.test" }],
        }),
      ),
    });
    expect(secondResponse.status).toBe(409);
    expect(((await secondResponse.json()) as { error: { code: string } }).error.code).toBe("MEMBER_CATEGORY_CONFLICT");

    // The conflicting attempt must not have mutated the existing category.
    expect(await categoryFor(aggregateId)).toBe("C");
  });

  it("reusing an existing organization with the SAME category succeeds and adds the new identity", async () => {
    const { organizationId } = await createOrg({ membershipCategory: "C" });

    const secondResponse = await call(adminToken, "/api/v1/organizations", {
      method: "POST",
      body: JSON.stringify(
        orgMemberBody({
          membershipCategory: "C",
          identities: [{ name: "Later Rep", email: "later@acme.test" }],
        }),
      ),
    });
    expect(secondResponse.status).toBe(201);
    const secondBody = (await secondResponse.json()) as { organization: { id: string } };
    expect(secondBody.organization.id).toBe(organizationId);

    const identityCount = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM identities WHERE organization_id = ? AND ended_at IS NULL",
      organizationId,
    );
    expect(Number(identityCount[0].total)).toBe(2);
  });
});
