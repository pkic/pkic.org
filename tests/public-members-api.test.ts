import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createContext } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestGet as getMember } from "../functions/api/v1/members/[id]";
import { onRequestGet as getMemberLogo } from "../functions/api/v1/members/[id]/logo";
import { onRequestGet as getWorkingGroup } from "../functions/api/v1/working-groups/[id]";
import { seedOrganizationAggregate, addRepresentative as addRepresentativeRow, insertUser } from "./helpers/membership";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import {
  membersListResponseSchema,
  memberWallResponseSchema,
  publicMemberDetailSchema,
  publicWorkingGroupMembersListResponseSchema,
} from "../assets/shared/schemas/members-directory";

async function callEndpoint(handler: (c: any) => Promise<Response>, ctx: any): Promise<Response> {
  try {
    return await handler(ctx);
  } catch (error) {
    return handleError(error);
  }
}

// Public list routes are validated by openApiRoute/chanfana, so exercise them
// through the mounted router to include validation and middleware behavior.
async function callPublicApi(url: string): Promise<Response> {
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

    const response = await callPublicApi("https://pkic.org/api/v1/members");

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

    const response = await callPublicApi("https://pkic.org/api/v1/members");
    const body = membersListResponseSchema.parse(await response.json());
    expect(body.page.total).toBe(1);
  });

  it("prefers the real organizations columns (consolidated migration 0035) over the legacy data_json blob", async () => {
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

    const response = await callPublicApi("https://pkic.org/api/v1/members");
    const body = (await response.json()) as {
      members: Array<{ website: string | null; description: string | null; slogan: string | null }>;
    };
    expect(body.members[0].website).toBe("https://real-column.test");
    expect(body.members[0].description).toBe("Real column description");
    expect(body.members[0].slogan).toBe("Real slogan");
  });

  it("omits unsafe legacy website and logo values at the public mapping boundary", async () => {
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      organizationName: "Legacy URL Org",
      status: "active",
      dataJson: JSON.stringify({ website: "javascript:alert(1)", logoUrl: "//evil.example/logo.svg" }),
    });

    const response = await callPublicApi("https://pkic.org/api/v1/members");
    expect(response.status).toBe(200);
    const body = membersListResponseSchema.parse(await response.json());
    expect(body.members[0].website).toBeNull();
    expect(body.members[0].logoUrl).toBeNull();
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

    const response = await callPublicApi("https://pkic.org/api/v1/members?q=acme");
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

    const orgOnly = await callPublicApi("https://pkic.org/api/v1/members?group=organization");
    const orgBody = membersListResponseSchema.parse(await orgOnly.json());
    expect(orgBody.page.total).toBe(1);

    const independentOnly = await callPublicApi("https://pkic.org/api/v1/members?group=independent");
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

    const response = await callPublicApi("https://pkic.org/api/v1/members?sort=-name&limit=1&offset=1");
    expect(response.status).toBe(200);
    const body = membersListResponseSchema.parse(await response.json());
    expect(body.members.map(({ name }) => name)).toEqual(["Beta Org"]);
    expect(body.page).toEqual({ limit: 1, offset: 1, total: 3, hasMore: true });
  });

  it("uses the shared maximum page size", async () => {
    const response = await callPublicApi("https://pkic.org/api/v1/members?limit=500");
    expect(response.status).toBe(400);
  });
});

describe("GET /api/v1/members/wall", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("joins sponsors and members in D1 while enforcing one final wall cap", async () => {
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

    const response = await callPublicApi("https://pkic.org/api/v1/members/wall?memberLimit=1");
    expect(response.status).toBe(200);
    const body = memberWallResponseSchema.parse(await response.json());
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.sponsorLevel).toBeGreaterThan(0);
  });

  it("never lets sponsor rows bypass the final wall bound", async () => {
    for (const index of [1, 2, 3]) {
      await env.DB.prepare(
        `INSERT INTO sponsorships
           (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key,
            tier, pipeline_stage, created_at, updated_at)
         VALUES (?, 'consortium', ?, 'https://sponsor.test', ?, 'Gold', 'active', datetime('now'), datetime('now'))`,
      )
        .bind(`wall-overflow-${index}`, `Overflow Sponsor ${index}`, `sponsor-logos/overflow-${index}.svg`)
        .run();
    }

    const response = await callPublicApi("https://pkic.org/api/v1/members/wall?memberLimit=2");
    expect(response.status).toBe(200);
    const body = memberWallResponseSchema.parse(await response.json());
    expect(body.entries).toHaveLength(2);
    expect(body.entries.every(({ sponsorLevel }) => sponsorLevel > 0)).toBe(true);
  });

  it("rejects an unbounded member limit", async () => {
    const response = await callPublicApi("https://pkic.org/api/v1/members/wall?memberLimit=999999");
    expect(response.status).toBe(400);
  });

  it("replaces an unsafe legacy sponsor destination with the same-origin sponsors page", async () => {
    await env.DB.prepare(
      `INSERT INTO sponsorships
         (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key,
          tier, pipeline_stage, created_at, updated_at)
       VALUES ('unsafe-wall-sponsor', 'consortium', 'Unsafe Sponsor', 'javascript:alert(1)',
               'sponsor-logos/unsafe.svg', 'Gold', 'active', datetime('now'), datetime('now'))`,
    ).run();

    const response = await callPublicApi("https://pkic.org/api/v1/members/wall");
    expect(response.status).toBe(200);
    const body = memberWallResponseSchema.parse(await response.json());
    expect(body.entries).toContainEqual(
      expect.objectContaining({ key: "sponsor:unsafe-wall-sponsor", href: "/sponsors/" }),
    );
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

  it("resolves by organizations.slug (consolidated migration 0035) as well as by id", async () => {
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

  it("omits unsafe legacy organization detail URLs while preserving valid HTTP links", async () => {
    const organizationId = crypto.randomUUID();
    await seedOrgMember({
      userId: crypto.randomUUID(),
      organizationId,
      organizationName: "Unsafe Detail URL Org",
      status: "active",
    });
    await env.DB.prepare(
      `UPDATE organizations
          SET website = ?, blog_url = ?, blog_feed_url = ?, press_url = ?, press_feed_url = ?, careers_url = ?
        WHERE id = ?`,
    )
      .bind(
        "javascript:alert(1)",
        "https://safe.example/blog",
        "data:text/html,unsafe",
        "//evil.example/press",
        "https://safe.example/press.xml",
        "/relative-careers",
        organizationId,
      )
      .run();

    const response = await callEndpoint(
      getMember,
      createContext(env, getRequest(`https://pkic.org/api/v1/members/${organizationId}`), { id: organizationId }),
    );
    expect(response.status).toBe(200);
    const body = publicMemberDetailSchema.parse(await response.json());
    expect(body).toMatchObject({
      website: null,
      blogUrl: "https://safe.example/blog",
      blogFeedUrl: null,
      pressUrl: null,
      pressFeedUrl: "https://safe.example/press.xml",
      careersUrl: null,
    });
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
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
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

    const listResponse = await callPublicApi("https://pkic.org/api/v1/members");
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

    const response = await callPublicApi("https://pkic.org/api/v1/working-groups");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workingGroups: Array<{ slug: string }>;
      page: { total: number; hasMore: boolean };
    };
    expect(body.workingGroups).toHaveLength(1);
    expect(body.workingGroups[0].slug).toBe("pqc");
    expect(body.page).toMatchObject({ total: 1, hasMore: false });
  });

  it("searches and pages working groups in D1 with deterministic ordering", async () => {
    await seedWorkingGroup({ id: "wg-z", name: "Zeta Working Group", slug: "zeta" });
    await seedWorkingGroup({ id: "wg-a", name: "Alpha Working Group", slug: "alpha" });

    const response = await callPublicApi("https://pkic.org/api/v1/working-groups?q=working&limit=1&offset=1&sort=name");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workingGroups: Array<{ slug: string }>;
      page: { total: number; offset: number; hasMore: boolean };
    };
    expect(body.workingGroups.map(({ slug }) => slug)).toEqual(["zeta"]);
    expect(body.page).toMatchObject({ total: 2, offset: 1, hasMore: false });
  });
});

describe("GET /api/v1/working-groups/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("keeps detail bounded and exposes the public roster through the shared list contract", async () => {
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

    const response = await callPublicApi("https://pkic.org/api/v1/working-groups/pqc");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { slug: string };
    expect(body.slug).toBe("pqc");
    expect(body).not.toHaveProperty("members");

    const listResponse = await callPublicApi("https://pkic.org/api/v1/working-groups/pqc/members?limit=1&sort=name");
    expect(listResponse.status).toBe(200);
    const roster = publicWorkingGroupMembersListResponseSchema.parse(await listResponse.json());
    expect(roster.members).toEqual([{ name: "Wg Member", organizationName: null }]);
    expect(roster.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });
  });

  it("searches the public working-group roster in D1 and rejects invalid list queries", async () => {
    const wgId = crypto.randomUUID();
    await seedWorkingGroup({ id: wgId, name: "PQC Working Group", slug: "pqc" });
    for (const [firstName, lastName] of [
      ["Alice", "Example"],
      ["Bob", "Other"],
    ]) {
      const userId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(userId, `${userId}@example.test`, `${userId}@example.test`, firstName, lastName),
        env.DB.prepare(
          `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at)
           VALUES (?, ?, ?, datetime('now'), NULL)`,
        ).bind(crypto.randomUUID(), wgId, userId),
      ]);
    }

    const response = await callPublicApi("https://pkic.org/api/v1/working-groups/pqc/members?q=other&sort=name");
    const body = publicWorkingGroupMembersListResponseSchema.parse(await response.json());
    expect(body.members.map((member) => member.name)).toEqual(["Bob Other"]);
    expect(body.page.total).toBe(1);

    const invalid = await callPublicApi("https://pkic.org/api/v1/working-groups/pqc/members?sort=email");
    expect(invalid.status).toBe(400);
  });

  it("returns 404 for inactive working-group detail and rosters by slug and UUID", async () => {
    const wgId = crypto.randomUUID();
    await seedWorkingGroup({ id: wgId, name: "Retired Working Group", slug: "retired", active: 0 });

    for (const idOrSlug of ["retired", wgId]) {
      const detailResponse = await callPublicApi(`https://pkic.org/api/v1/working-groups/${idOrSlug}`);
      expect(detailResponse.status).toBe(404);

      const membersResponse = await callPublicApi(`https://pkic.org/api/v1/working-groups/${idOrSlug}/members`);
      expect(membersResponse.status).toBe(404);
    }
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

  it("omits unsafe persisted chair website and LinkedIn values", async () => {
    const wgId = crypto.randomUUID();
    await seedWorkingGroup({ id: wgId, name: "PQC Working Group", slug: "pqc" });
    const chairUserId = crypto.randomUUID();
    const orgId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, website, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(orgId, "Unsafe Chair Org", "unsafe chair org", "javascript:alert(1)"),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, links_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(
        chairUserId,
        `${chairUserId}@example.test`,
        `${chairUserId}@example.test`,
        "Unsafe",
        "Chair",
        JSON.stringify({ linkedin: "javascript:alert(2)" }),
      ),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
         VALUES (?, ?, 'role-wg_chair', 'working_group', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), chairUserId, wgId),
    ]);
    const memberId = await seedOrganizationAggregate(env.DB, orgId, "A");
    await addRepresentativeRow(env.DB, memberId, chairUserId);

    const response = await callEndpoint(
      getWorkingGroup,
      createContext(env, getRequest("https://pkic.org/api/v1/working-groups/pqc"), { id: "pqc" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chair: { organizationWebsite: string | null; linkedin: string | null } | null;
    };
    expect(body.chair?.organizationWebsite).toBeNull();
    expect(body.chair?.linkedin).toBeNull();
  });

  it("returns 404 for unknown working-group detail and roster routes", async () => {
    const detailResponse = await callPublicApi("https://pkic.org/api/v1/working-groups/does-not-exist");
    expect(detailResponse.status).toBe(404);

    const membersResponse = await callPublicApi("https://pkic.org/api/v1/working-groups/does-not-exist/members");
    expect(membersResponse.status).toBe(404);
  });
});
