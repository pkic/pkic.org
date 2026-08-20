import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createContext } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestGet as getMember } from "../functions/api/v1/members/[id]";
import { onRequestGet as getMemberLogo } from "../functions/api/v1/members/[id]/logo";
import { onRequestGet as listWorkingGroups } from "../functions/api/v1/working-groups/index";
import { onRequestGet as getWorkingGroup } from "../functions/api/v1/working-groups/[id]";
import { seedOrganizationAggregate, addRepresentative as addRepresentativeRow, insertUser } from "./helpers/membership";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import {
  membersListResponseSchema,
  memberWallResponseSchema,
  publicMemberDetailSchema,
} from "../assets/shared/schemas/members-directory";

async function callEndpoint(handler: (c: any) => Promise<Response>, ctx: any): Promise<Response> {
  try {
    return await handler(ctx);
  } catch (error) {
    return handleError(error);
  }
}

// GET /api/v1/members is validated by openApiRoute/chanfana (data.query),
// so it must be exercised through the real router — not by calling its
// onRequestGet handler directly, which would leave data.query unpopulated.
async function callMembersList(url: string): Promise<Response> {
  return app.fetch(new Request(url), env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
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
  ]);
  const memberId = await seedOrganizationAggregate(env.DB, params.organizationId, params.tier ?? "A");
  if (params.status !== "active") {
    await env.DB.prepare("UPDATE members SET status = ? WHERE id = ?").bind(params.status, memberId).run();
  }
  await addRepresentativeRow(env.DB, memberId, params.userId);
  return memberId;
}

async function seedIndividualMember(params: { userId: string; status: string; tier?: string }) {
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(params.userId, `${params.userId}@example.test`, `${params.userId}@example.test`, "Solo", "Member")
    .run();
  const { statements } = buildCreateIndividualMemberStatements(
    env.DB,
    params.userId,
    params.tier ?? "H6",
    new Date().toISOString(),
  );
  await env.DB.batch(statements);
  if (params.status !== "active") {
    await env.DB.prepare("UPDATE members SET status = ? WHERE user_id = ?").bind(params.status, params.userId).run();
  }
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

    const response = await callMembersList("https://pkic.org/api/v1/members");

    expect(response.status).toBe(200);
    const body = membersListResponseSchema.parse(await response.json());
    expect(body.page.total).toBe(1);
    expect(body.members).toHaveLength(1);
    expect(body.members[0].name).toBe("Active Org");
    expect(body.members[0].website).toBe("https://active-org.test");
  });

  it("surfaces only one directory entry per organization even with multiple representatives", async () => {
    const organizationId = crypto.randomUUID();
    const memberId = await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "Multi Rep Org",
      status: "active",
    });
    // Second representative for the same org — should not create a second directory entry.
    const secondUserId = await insertUser(env.DB);
    await addRepresentativeRow(env.DB, memberId, secondUserId);

    const response = await callMembersList("https://pkic.org/api/v1/members");
    const body = membersListResponseSchema.parse(await response.json());
    expect(body.page.total).toBe(1);
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

    const response = await callMembersList("https://pkic.org/api/v1/members");
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

    const response = await callMembersList("https://pkic.org/api/v1/members?q=acme");
    const body = membersListResponseSchema.parse(await response.json());
    expect(body.page.total).toBe(1);
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

    const orgOnly = await callMembersList("https://pkic.org/api/v1/members?group=organization");
    const orgBody = membersListResponseSchema.parse(await orgOnly.json());
    expect(orgBody.page.total).toBe(1);

    const independentOnly = await callMembersList("https://pkic.org/api/v1/members?group=independent");
    const independentBody = membersListResponseSchema.parse(await independentOnly.json());
    expect(independentBody.page.total).toBe(1);
  });

  it("sorts and paginates in D1 with a deterministic response envelope", async () => {
    for (const name of ["Alpha Org", "Beta Org", "Gamma Org"]) {
      await seedOrgMember({
        userId: crypto.randomUUID(),
        organizationId: crypto.randomUUID(),
        organizationName: name,
        status: "active",
      });
    }

    const response = await callMembersList("https://pkic.org/api/v1/members?sort=-name&limit=1&offset=1");
    expect(response.status).toBe(200);
    const body = membersListResponseSchema.parse(await response.json());
    expect(body.members.map(({ name }) => name)).toEqual(["Beta Org"]);
    expect(body.page).toEqual({ limit: 1, offset: 1, total: 3, hasMore: true });
  });

  it("uses the shared maximum page size", async () => {
    const response = await callMembersList("https://pkic.org/api/v1/members?limit=500");
    expect(response.status).toBe(400);
  });
});

describe("GET /api/v1/members/wall", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("joins sponsors and members in D1 while applying the cap only to non-sponsors", async () => {
    const sponsorOrgId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId: sponsorOrgId,
      organizationName: "Sponsor Member",
      status: "active",
    });
    await env.DB.prepare(
      "UPDATE organizations SET logo_r2_key = 'org-logos/sponsor.svg', sponsor_tier = 'Gold' WHERE id = ?",
    )
      .bind(sponsorOrgId)
      .run();

    for (const name of ["Regular Alpha", "Regular Beta"]) {
      const organizationId = crypto.randomUUID();
      await seedOrgMember({
        userId: crypto.randomUUID(),
        organizationId,
        organizationName: name,
        status: "active",
      });
      await env.DB.prepare("UPDATE organizations SET logo_r2_key = 'org-logos/regular.svg' WHERE id = ?")
        .bind(organizationId)
        .run();
    }

    await env.DB.prepare(
      `INSERT INTO sponsorships
         (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key,
          tier, pipeline_stage, created_at, updated_at)
       VALUES ('wall-non-member', 'consortium', 'External Sponsor', 'https://sponsor.test',
               'sponsor-logos/external.svg', 'Gold', 'active', datetime('now'), datetime('now'))`,
    ).run();

    const response = await callMembersList("https://pkic.org/api/v1/members/wall?memberLimit=1");
    expect(response.status).toBe(200);
    const body = memberWallResponseSchema.parse(await response.json());
    expect(body.entries).toHaveLength(3);
    expect(
      body.entries
        .filter(({ sponsorLevel }) => sponsorLevel > 0)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(["External Sponsor", "Sponsor Member"]);
    expect(body.entries.filter(({ sponsorLevel }) => sponsorLevel === 0)).toHaveLength(1);
  });

  it("rejects an unbounded member limit", async () => {
    const response = await callMembersList("https://pkic.org/api/v1/members/wall?memberLimit=999999");
    expect(response.status).toBe(400);
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
    const body = publicMemberDetailSchema.parse(await response.json());
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

  it("resolves by organizations.slug (migration 0047) as well as by id", async () => {
    const organizationId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "Slug Org",
      status: "active",
    });
    await env.DB.prepare("UPDATE organizations SET slug = ? WHERE id = ?").bind("slug-org", organizationId).run();

    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest("https://pkic.org/api/v1/members/slug-org"), { id: "slug-org" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; slug: string | null; name: string };
    expect(body.id).toBe(organizationId);
    expect(body.slug).toBe("slug-org");
    expect(body.name).toBe("Slug Org");
  });

  it("includes org content fields and only show_on_org_profile=1 representatives", async () => {
    const organizationId = crypto.randomUUID();
    const shownUserId = crypto.randomUUID();
    const memberId = await seedOrgMember({
      userId: shownUserId,
      organizationId,
      organizationName: "Content Org",
      status: "active",
    });
    await env.DB.prepare(`UPDATE organizations SET content_markdown = ?, blog_url = ?, links_json = ? WHERE id = ?`)
      .bind(
        "## About us",
        "https://content-org.test/blog",
        JSON.stringify(["https://linkedin.com/company/content-org"]),
        organizationId,
      )
      .run();
    await env.DB.prepare(`UPDATE users SET job_title = ?, biography = ? WHERE id = ?`)
      .bind("CTO", "Leads engineering.", shownUserId)
      .run();

    const hiddenUserId = await insertUser(env.DB);
    await addRepresentativeRow(env.DB, memberId, hiddenUserId, { showOnOrgProfile: false });

    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}`), { id: organizationId }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      content: string | null;
      blogUrl: string | null;
      links: string[];
      representatives: Array<{ name: string; jobTitle: string | null; bio: string | null }>;
    };
    expect(body.content).toBe("## About us");
    expect(body.blogUrl).toBe("https://content-org.test/blog");
    expect(body.links).toEqual(["https://linkedin.com/company/content-org"]);
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
    const repRow = await env.DB.prepare(`SELECT id FROM organization_representatives WHERE user_id = ?`)
      .bind(repUserId)
      .first<{ id: string }>();
    expect(body.representatives[0].photoUrl).toBe(`/api/v1/members/${repRow!.id}/logo`);
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

    const listResponse = await callMembersList("https://pkic.org/api/v1/members");
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

  it("serves an organization representative's photo keyed by their own organization_representatives.id", async () => {
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

    const repRow = await env.DB.prepare(`SELECT id FROM organization_representatives WHERE user_id = ?`)
      .bind(repUserId)
      .first<{ id: string }>();

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
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${repRow!.id}/logo`), {
        id: repRow!.id,
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

  it("returns the chair and vice chair resolved from user_roles, not the static YAML frontmatter", async () => {
    const wgId = crypto.randomUUID();
    await seedWorkingGroup({ id: wgId, name: "PQC Working Group", slug: "pqc" });

    const chairUserId = crypto.randomUUID();
    const viceChairUserId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(chairUserId, `${chairUserId}@example.test`, `${chairUserId}@example.test`, "Chair", "Person"),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(viceChairUserId, `${viceChairUserId}@example.test`, `${viceChairUserId}@example.test`, "Vice", "Chair"),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
         VALUES (?, ?, 'role-wg_chair', 'working_group', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), chairUserId, wgId),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
         VALUES (?, ?, 'role-wg_vice_chair', 'working_group', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), viceChairUserId, wgId),
    ]);

    const response = await callEndpoint(
      getWorkingGroup,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups/pqc"), { id: "pqc" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chair: { name: string } | null;
      viceChair: { name: string } | null;
    };
    expect(body.chair?.name).toBe("Chair Person");
    expect(body.viceChair?.name).toBe("Vice Chair");
  });

  it("enriches the chair with photo, LinkedIn, and organization logo/website", async () => {
    const wgId = crypto.randomUUID();
    await seedWorkingGroup({ id: wgId, name: "PQC Working Group", slug: "pqc" });

    const chairUserId = crypto.randomUUID();
    const orgId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, website, logo_r2_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(orgId, "Chair Org", "chair org", "https://chairorg.example", "members/chair-org/logo.png"),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, headshot_r2_key, links_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(
        chairUserId,
        `${chairUserId}@example.test`,
        `${chairUserId}@example.test`,
        "Chair",
        "Person",
        "headshots/chair.jpg",
        JSON.stringify({ linkedin: "https://linkedin.com/in/chairperson" }),
      ),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
         VALUES (?, ?, 'role-wg_chair', 'working_group', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), chairUserId, wgId),
    ]);
    const aggregateId = await seedOrganizationAggregate(env.DB, orgId, "A");
    const representativeId = await addRepresentativeRow(env.DB, aggregateId, chairUserId);

    const response = await callEndpoint(
      getWorkingGroup,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups/pqc"), { id: "pqc" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chair: {
        name: string;
        organizationName: string | null;
        organizationLogoUrl: string | null;
        organizationWebsite: string | null;
        photoUrl: string | null;
        linkedin: string | null;
      } | null;
    };
    expect(body.chair?.organizationName).toBe("Chair Org");
    expect(body.chair?.organizationWebsite).toBe("https://chairorg.example");
    expect(body.chair?.organizationLogoUrl).toBe(`/api/v1/members/${orgId}/logo`);
    expect(body.chair?.photoUrl).toBe(`/api/v1/members/${representativeId}/logo`);
    expect(body.chair?.linkedin).toBe("https://linkedin.com/in/chairperson");
  });

  it("returns null enrichment fields for a chair with no photo, LinkedIn, or org logo on file", async () => {
    const wgId = crypto.randomUUID();
    await seedWorkingGroup({ id: wgId, name: "PQC Working Group", slug: "pqc" });

    const chairUserId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(chairUserId, `${chairUserId}@example.test`, `${chairUserId}@example.test`, "Bare", "Chair"),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
         VALUES (?, ?, 'role-wg_chair', 'working_group', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), chairUserId, wgId),
    ]);

    const response = await callEndpoint(
      getWorkingGroup,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups/pqc"), { id: "pqc" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chair: {
        organizationLogoUrl: string | null;
        organizationWebsite: string | null;
        photoUrl: string | null;
        linkedin: string | null;
      } | null;
    };
    expect(body.chair?.organizationLogoUrl).toBeNull();
    expect(body.chair?.organizationWebsite).toBeNull();
    expect(body.chair?.photoUrl).toBeNull();
    expect(body.chair?.linkedin).toBeNull();
  });

  it("returns 404 for an unknown working group", async () => {
    const response = await callEndpoint(
      getWorkingGroup,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups/does-not-exist"), { id: "does-not-exist" }),
    );
    expect(response.status).toBe(404);
  });
});
