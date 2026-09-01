import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { updateOrganization } from "../functions/_lib/services/organization-management";
import { buildOrganizationsPageQuery } from "../functions/_lib/services/organization-management/read-model";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

function request(path: string, token?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(path, token, init),
    env as never,
    { passThroughOnException: () => {}, waitUntil: () => {} } as never,
  );
}

async function adminToken(): Promise<{ id: string; token: string }> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE normalized_email = 'admin@pkic.org'",
  );
  return {
    id: admin.id,
    token: await createAdminSession(env.DB, admin.id, `organization-management-${crypto.randomUUID()}`),
  };
}

async function grantToken(
  ...permissions: Array<"identities:activate" | "membership:write" | "organizations:read" | "organizations:write">
) {
  const userId = await insertUser(
    env.DB,
    `organization-${permissions.join("-").replaceAll(":", "-")}-${crypto.randomUUID()}@example.test`,
  );
  await env.DB.batch(
    permissions.map((permission) =>
      env.DB.prepare(
        `INSERT INTO permission_grants
             (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
           VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), userId, permission, userId),
    ),
  );
  return {
    userId,
    token: await createAdminSession(env.DB, userId, `organization-staff-${crypto.randomUUID()}`),
  };
}

function createBody(name = "Canonical Organization") {
  return {
    name,
    membershipCategory: "F",
    memberSince: "2026-01-15",
    identities: [{ name: "Jane Doe", email: `${name.toLowerCase().replaceAll(" ", ".")}@example.test` }],
    workingGroupSlugs: [],
    activationReason: "Initial verified organization identity",
  };
}

describe("canonical organization management", () => {
  beforeEach(resetDb);

  it("uses the domain API with exact read/write permissions and no API-key fallback", async () => {
    const admin = await adminToken();
    const writer = await grantToken("membership:write", "identities:activate");
    const reader = await grantToken("organizations:read");

    const created = await call("/api/v1/organizations", writer.token, {
      method: "POST",
      body: JSON.stringify(createBody()),
    });
    expect(created.status).toBe(201);
    const organization = (await created.json()) as { organization: { id: string } };

    expect((await call("/api/v1/organizations", writer.token)).status).toBe(403);
    expect((await call(`/api/v1/organizations/${organization.organization.id}`, reader.token)).status).toBe(200);
    expect((await call("/api/v1/organizations", env.ADMIN_API_KEY ?? "test-admin-key")).status).toBe(403);
    expect((await call("/api/v1/admin/organizations", admin.token)).status).toBe(404);
  });

  it("creates an organization without identities on membership:write alone, and persists its links", async () => {
    await adminToken();
    // No identities:activate: nobody is being activated, so none is demanded.
    const writer = await grantToken("membership:write");

    const created = await call("/api/v1/organizations", writer.token, {
      method: "POST",
      body: JSON.stringify({
        name: "Peopleless Organization",
        membershipCategory: "F",
        memberSince: "2026-01-15",
        website: "https://peopleless.example.test",
        links: ["https://www.linkedin.com/company/peopleless"],
        identities: [],
        workingGroupSlugs: [],
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const body = (await created.json()) as {
      organization: { activeIdentityCount: number; identities: unknown[]; links: string[] };
    };
    expect(body.organization.identities).toEqual([]);
    expect(body.organization.activeIdentityCount).toBe(0);
    expect(body.organization.links).toEqual(["https://www.linkedin.com/company/peopleless"]);
  });

  it("still demands identities:activate and an activation reason exactly when identities are provided", async () => {
    await adminToken();
    const writer = await grantToken("membership:write");
    const activator = await grantToken("membership:write", "identities:activate");

    // Providing people without the activation permission is refused before
    // anything is written.
    const forbidden = await call("/api/v1/organizations", writer.token, {
      method: "POST",
      body: JSON.stringify(createBody("Forbidden Organization")),
    });
    expect(forbidden.status).toBe(403);

    // Providing people without a reason fails the shared contract itself.
    const { activationReason: _dropped, ...withoutReason } = createBody("Reasonless Organization");
    const unreasoned = await call("/api/v1/organizations", activator.token, {
      method: "POST",
      body: JSON.stringify(withoutReason),
    });
    expect(unreasoned.status).toBe(400);

    const created = await call("/api/v1/organizations", activator.token, {
      method: "POST",
      body: JSON.stringify(createBody("Reasoned Organization")),
    });
    expect(created.status, await created.clone().text()).toBe(201);
  });

  it("requires a current revision and rolls back a write when permission changes before the D1 batch", async () => {
    const admin = await adminToken();
    const created = await call("/api/v1/organizations", admin.token, {
      method: "POST",
      body: JSON.stringify(createBody("Revision Organization")),
    });
    const organization = (await created.json()) as { organization: { id: string; updatedAt: string } };

    const stale = await call(`/api/v1/organizations/${organization.organization.id}`, admin.token, {
      method: "PATCH",
      body: JSON.stringify({ revision: "stale-revision", description: "must not persist" }),
    });
    expect(stale.status).toBe(409);

    const writer = await grantToken("organizations:write");
    const actor = createUserBackedAuthAdmin({
      id: writer.userId,
      email: `organization-actor-${writer.userId}@example.test`,
      role: "user",
      scopes: [],
      grants: [{ permission: "organizations:write", contextType: null, contextId: null }],
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ?")
        .bind(writer.userId)
        .run(),
    );
    await expect(
      updateOrganization(racedDb, actor, organization.organization.id, {
        revision: organization.organization.updatedAt,
        description: "must not persist",
      }),
    ).rejects.toMatchObject({ status: 409, code: "ORGANIZATION_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll<{ description: string | null }>(
        env.DB,
        "SELECT description FROM organizations WHERE id = ?",
        organization.organization.id,
      ),
    ).toEqual([{ description: null }]);
  });

  it("keeps list search, sorting, and pagination in a single D1 projection", async () => {
    await adminToken();
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(
      buildOrganizationsPageQuery({ q: "consortium", sort: "-identity_count", limit: 25, offset: 0 }),
    );
    const plans = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, 25, 0)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all<{ detail: string }>(),
    ]);
    const detail = plans.flatMap((plan) => plan.results.map((row) => row.detail)).join("\n");
    expect(pageSql).toMatch(/ORDER BY active_identity_count DESC/i);
    expect(countSql).toMatch(/^SELECT COUNT\(\*\) AS total\s+FROM organizations o/i);
    expect(countSql).not.toMatch(/\bidentities\b|primary_contact/i);
    expect(detail).toContain("idx_identities_organization_lifecycle");
  });
});
