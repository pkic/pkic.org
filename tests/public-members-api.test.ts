import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestGet as listMembers } from "../functions/api/v1/members/index";
import { onRequestGet as getMember } from "../functions/api/v1/members/[id]";
import { onRequestGet as listWorkingGroups } from "../functions/api/v1/working-groups/index";
import { onRequestGet as getWorkingGroup } from "../functions/api/v1/working-groups/[id]";

async function callEndpoint(handler: (c: any) => Promise<Response>, ctx: any): Promise<Response> {
  try {
    return await handler(ctx);
  } catch (error) {
    return handleError(error);
  }
}

function getRequest(url: string) {
  return new Request(url);
}

async function seedOrgMember(params: {
  userId: string;
  organizationId: string;
  organizationName: string;
  status: string;
  tier?: string;
  dataJson?: string | null;
}) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(params.userId, `${params.userId}@example.test`, `${params.userId}@example.test`, "Rep", "Person"),
    env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(params.organizationId, params.organizationName, params.organizationName.toLowerCase(), params.dataJson ?? null),
    env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, created_at, updated_at)
       VALUES (?, 'organization', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(crypto.randomUUID(), params.userId, params.organizationId, params.status, params.tier ?? "A"),
  ]);
}

async function seedIndividualMember(params: { userId: string; status: string; tier?: string }) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(params.userId, `${params.userId}@example.test`, `${params.userId}@example.test`, "Solo", "Member"),
    env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, created_at, updated_at)
       VALUES (?, 'individual', ?, NULL, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(crypto.randomUUID(), params.userId, params.status, params.tier ?? "H6"),
  ]);
}

describe("GET /api/v1/members (public directory)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns a paginated list of active members only", async () => {
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      organizationName: "Active Org",
      status: "active",
      dataJson: JSON.stringify({ website: "https://active-org.test", description: "An active member org." }),
    });
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      organizationName: "Pending Org",
      status: "pending",
    });
    await seedIndividualMember({ userId: crypto.randomUUID(), status: "inactive" });

    const response = await callEndpoint(
      listMembers,
      createContext(env, getRequest("https://pkic.org/api/v1/members"), {}),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      members: Array<{ name: string; website: string | null; description: string | null }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.members).toHaveLength(1);
    expect(body.members[0].name).toBe("Active Org");
    expect(body.members[0].website).toBe("https://active-org.test");
  });

  it("surfaces only one directory entry per organization even with multiple representatives", async () => {
    const organizationId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "Multi Rep Org",
      status: "active",
    });
    // Second representative for the same org — should not create a second directory entry.
    const secondUserId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(secondUserId, `${secondUserId}@example.test`, `${secondUserId}@example.test`, "Second", "Rep"),
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, created_at, updated_at)
         VALUES (?, 'organization', ?, ?, 'active', 'A', datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), secondUserId, organizationId),
    ]);

    const response = await callEndpoint(
      listMembers,
      createContext(env, getRequest("https://pkic.org/api/v1/members"), {}),
    );
    const body = (await response.json()) as { total: number };
    expect(body.total).toBe(1);
  });
});

describe("GET /api/v1/members/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns public profile fields for an organization-tied member", async () => {
    const organizationId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "Detail Org",
      status: "active",
      dataJson: JSON.stringify({ website: "https://detail-org.test" }),
    });

    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}`), { id: organizationId }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; name: string; website: string | null };
    expect(body.id).toBe(organizationId);
    expect(body.name).toBe("Detail Org");
    expect(body.website).toBe("https://detail-org.test");
  });

  it("returns 404 for an unknown id", async () => {
    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest("https://pkic.org/api/v1/members/does-not-exist"), { id: "does-not-exist" }),
    );
    expect(response.status).toBe(404);
  });
});

async function seedWorkingGroup(params: { id: string; name: string; slug: string; active?: number }) {
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(params.id, params.name, params.slug, `${params.name} description`, params.active ?? 1)
    .run();
}

describe("GET /api/v1/working-groups", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists only active working groups", async () => {
    await seedWorkingGroup({ id: crypto.randomUUID(), name: "PQC Working Group", slug: "pqc" });
    await seedWorkingGroup({ id: crypto.randomUUID(), name: "Retired Working Group", slug: "retired", active: 0 });

    const response = await callEndpoint(
      listWorkingGroups,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups"), {}),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { workingGroups: Array<{ slug: string }> };
    expect(body.workingGroups).toHaveLength(1);
    expect(body.workingGroups[0].slug).toBe("pqc");
  });
});

describe("GET /api/v1/working-groups/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns working group detail with a public subset of the member list, looked up by slug", async () => {
    const wgId = crypto.randomUUID();
    await seedWorkingGroup({ id: wgId, name: "PQC Working Group", slug: "pqc" });

    const userId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(userId, `${userId}@example.test`, `${userId}@example.test`, "Wg", "Member"),
      env.DB.prepare(
        `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at)
         VALUES (?, ?, ?, datetime('now'), NULL)`,
      ).bind(crypto.randomUUID(), wgId, userId),
    ]);

    const response = await callEndpoint(
      getWorkingGroup,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups/pqc"), { id: "pqc" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { slug: string; members: Array<{ name: string }> };
    expect(body.slug).toBe("pqc");
    expect(body.members).toHaveLength(1);
    expect(body.members[0].name).toBe("Wg Member");
  });

  it("returns 404 for an unknown working group", async () => {
    const response = await callEndpoint(
      getWorkingGroup,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups/does-not-exist"), { id: "does-not-exist" }),
    );
    expect(response.status).toBe(404);
  });
});
