import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestGet as listMembers } from "../functions/api/v1/members/index";
import { onRequestGet as getMember } from "../functions/api/v1/members/[id]";
import { onRequestGet as getMemberLogo } from "../functions/api/v1/members/[id]/logo";
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
    ).bind(
      params.organizationId,
      params.organizationName,
      params.organizationName.toLowerCase(),
      params.dataJson ?? null,
    ),
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

  it("prefers the real organizations columns (migration 0037) over the legacy data_json blob", async () => {
    const organizationId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "Real Columns Org",
      status: "active",
      dataJson: JSON.stringify({ website: "https://stale-data-json.test", description: "Stale description" }),
    });
    await env.DB.prepare(`UPDATE organizations SET description = ?, website = ?, slogan = ? WHERE id = ?`)
      .bind("Real column description", "https://real-column.test", "Real slogan", organizationId)
      .run();

    const response = await callEndpoint(
      listMembers,
      createContext(env, getRequest("https://pkic.org/api/v1/members"), {}),
    );
    const body = (await response.json()) as {
      members: Array<{ website: string | null; description: string | null; slogan: string | null }>;
    };
    expect(body.members[0].website).toBe("https://real-column.test");
    expect(body.members[0].description).toBe("Real column description");
    expect(body.members[0].slogan).toBe("Real slogan");
  });

  it("filters by search text (q)", async () => {
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      organizationName: "Acme Cryptography",
      status: "active",
    });
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      organizationName: "Zenith Security",
      status: "active",
    });

    const response = await callEndpoint(
      listMembers,
      createContext(env, getRequest("https://pkic.org/api/v1/members?q=acme"), {}),
    );
    const body = (await response.json()) as { members: Array<{ name: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.members[0].name).toBe("Acme Cryptography");
  });

  it("filters by group=independent vs group=organization", async () => {
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      organizationName: "Org Member Co",
      status: "active",
    });
    await seedIndividualMember({ userId: crypto.randomUUID(), status: "active", tier: "H6" });

    const orgOnly = await callEndpoint(
      listMembers,
      createContext(env, getRequest("https://pkic.org/api/v1/members?group=organization"), {}),
    );
    const orgBody = (await orgOnly.json()) as { total: number };
    expect(orgBody.total).toBe(1);

    const independentOnly = await callEndpoint(
      listMembers,
      createContext(env, getRequest("https://pkic.org/api/v1/members?group=independent"), {}),
    );
    const independentBody = (await independentOnly.json()) as { total: number };
    expect(independentBody.total).toBe(1);
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

  it("includes org content fields and only show_on_org_profile=1 representatives", async () => {
    const organizationId = crypto.randomUUID();
    const shownUserId = crypto.randomUUID();
    await seedOrgMember({
      userId: shownUserId,
      organizationId,
      organizationName: "Content Org",
      status: "active",
    });
    await env.DB.prepare(
      `UPDATE organizations SET content_markdown = ?, blog_url = ?, social_linkedin = ? WHERE id = ?`,
    )
      .bind("## About us", "https://content-org.test/blog", "https://linkedin.com/company/content-org", organizationId)
      .run();
    await env.DB.prepare(`UPDATE users SET job_title = ?, biography = ? WHERE id = ?`)
      .bind("CTO", "Leads engineering.", shownUserId)
      .run();

    const hiddenUserId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(hiddenUserId, `${hiddenUserId}@example.test`, `${hiddenUserId}@example.test`, "Hidden", "Rep"),
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, created_at, updated_at, show_on_org_profile)
         VALUES (?, 'organization', ?, ?, 'active', 'A', datetime('now'), datetime('now'), 0)`,
      ).bind(crypto.randomUUID(), hiddenUserId, organizationId),
    ]);

    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}`), { id: organizationId }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      content: string | null;
      blogUrl: string | null;
      social: { linkedin: string | null };
      representatives: Array<{ name: string; jobTitle: string | null; bio: string | null }>;
    };
    expect(body.content).toBe("## About us");
    expect(body.blogUrl).toBe("https://content-org.test/blog");
    expect(body.social.linkedin).toBe("https://linkedin.com/company/content-org");
    expect(body.representatives).toHaveLength(1);
    expect(body.representatives[0]).toMatchObject({ name: "Rep Person", jobTitle: "CTO", bio: "Leads engineering." });
  });

  it("surfaces a representative's own photoUrl when their headshot_r2_key is set", async () => {
    const organizationId = crypto.randomUUID();
    const repUserId = crypto.randomUUID();
    await seedOrgMember({
      userId: repUserId,
      organizationId,
      organizationName: "Photo Org",
      status: "active",
    });
    await env.DB.prepare(`UPDATE users SET headshot_r2_key = ? WHERE id = ?`)
      .bind("member-photos/photo-org/rep-person.jpg", repUserId)
      .run();

    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}`), { id: organizationId }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      representatives: Array<{ name: string; photoUrl: string | null }>;
    };
    expect(body.representatives).toHaveLength(1);
    const repMemberRow = await env.DB.prepare(`SELECT id FROM members WHERE user_id = ?`).bind(repUserId).first<{
      id: string;
    }>();
    expect(body.representatives[0].photoUrl).toBe(`/api/v1/members/${repMemberRow!.id}/logo`);
  });

  it("returns the individual member's own bio/job title, with no representatives list", async () => {
    const userId = crypto.randomUUID();
    await seedIndividualMember({ userId, status: "active", tier: "H6" });
    await env.DB.prepare(`UPDATE users SET job_title = ?, biography = ? WHERE id = ?`)
      .bind("Independent Researcher", "Works on PQC migration.", userId)
      .run();
    const memberRow = await env.DB.prepare(`SELECT id FROM members WHERE user_id = ?`).bind(userId).first<{
      id: string;
    }>();

    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${memberRow!.id}`), { id: memberRow!.id }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      description: string | null;
      jobTitle: string | null;
      representatives: unknown[];
    };
    expect(body.jobTitle).toBe("Independent Researcher");
    expect(body.description).toBe("Works on PQC migration.");
    expect(body.representatives).toHaveLength(0);
  });
});

describe("GET /api/v1/members/:id/logo", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns 404 when the organization has no logo on file", async () => {
    const organizationId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "No Logo Org",
      status: "active",
    });

    const response = await callEndpoint(
      getMemberLogo,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}/logo`), {
        id: organizationId,
      }),
    );
    expect(response.status).toBe(404);
  });

  it("serves the logo bytes from R2 when logo_r2_key is set", async () => {
    const organizationId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "Logo Org",
      status: "active",
    });
    const r2Key = `org-logos/logo-org/logo.png`;
    await env.DB.prepare(`UPDATE organizations SET logo_r2_key = ? WHERE id = ?`).bind(r2Key, organizationId).run();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await env.ASSETS_BUCKET!.put(r2Key, bytes);

    const response = await callEndpoint(
      getMemberLogo,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}/logo`), {
        id: organizationId,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const buf = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
  });

  it("serves an org-less individual's photo from their own headshot_r2_key", async () => {
    const userId = crypto.randomUUID();
    await seedIndividualMember({ userId, status: "active" });
    const r2Key = `member-photos/solo-member/photo.jpg`;
    await env.DB.prepare(`UPDATE users SET headshot_r2_key = ? WHERE id = ?`).bind(r2Key, userId).run();
    const bytes = new Uint8Array([5, 6, 7, 8]);
    await env.ASSETS_BUCKET!.put(r2Key, bytes);

    const memberRow = await env.DB.prepare(`SELECT id FROM members WHERE user_id = ?`).bind(userId).first<{
      id: string;
    }>();

    const listResponse = await callEndpoint(
      listMembers,
      createContext(env, getRequest("https://pkic.org/api/v1/members"), {}),
    );
    const listBody = (await listResponse.json()) as { members: Array<{ id: string; logoUrl: string | null }> };
    expect(listBody.members[0].logoUrl).toBe(`/api/v1/members/${memberRow!.id}/logo`);

    const response = await callEndpoint(
      getMemberLogo,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${memberRow!.id}/logo`), {
        id: memberRow!.id,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    const buf = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(buf)).toEqual([5, 6, 7, 8]);
  });

  it("serves an organization representative's photo keyed by their own members.id", async () => {
    const organizationId = crypto.randomUUID();
    const repUserId = crypto.randomUUID();
    await seedOrgMember({
      userId: repUserId,
      organizationId,
      organizationName: "Rep Photo Org",
      status: "active",
    });
    const r2Key = `member-photos/rep-photo-org/rep-person.jpg`;
    await env.DB.prepare(`UPDATE users SET headshot_r2_key = ? WHERE id = ?`).bind(r2Key, repUserId).run();
    const bytes = new Uint8Array([9, 9, 9]);
    await env.ASSETS_BUCKET!.put(r2Key, bytes);

    const repMemberRow = await env.DB.prepare(`SELECT id FROM members WHERE user_id = ?`).bind(repUserId).first<{
      id: string;
    }>();

    // The organization's own id must not resolve to the representative's photo.
    const orgLogoResponse = await callEndpoint(
      getMemberLogo,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}/logo`), {
        id: organizationId,
      }),
    );
    expect(orgLogoResponse.status).toBe(404);

    const response = await callEndpoint(
      getMemberLogo,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${repMemberRow!.id}/logo`), {
        id: repMemberRow!.id,
      }),
    );
    expect(response.status).toBe(200);
    const buf = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(buf)).toEqual([9, 9, 9]);
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
