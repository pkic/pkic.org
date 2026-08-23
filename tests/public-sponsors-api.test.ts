import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createContext } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestGet as getSponsorLogo } from "../functions/api/v1/sponsors/[id]/logo";
import { listPublicSponsors } from "../functions/_lib/services/public-sponsors";
import { buildPublicSponsorPageQuery } from "../functions/_lib/services/public-sponsors";

async function callEndpoint(handler: (c: any) => Promise<Response>, ctx: any): Promise<Response> {
  try {
    return await handler(ctx);
  } catch (error) {
    return handleError(error);
  }
}

// GET /api/v1/sponsors is validated by openApiRoute/chanfana (data.query),
// so it must be exercised through the real router — not by calling its
// onRequestGet handler directly, which would leave data.query unpopulated.
async function callSponsorsList(url: string): Promise<Response> {
  return app.fetch(new Request(url), env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

function getRequest(url: string) {
  return new Request(url);
}

async function seedOrganization(params: { id: string; name: string; sponsorTier?: string | null }) {
  await env.DB.prepare(
    `INSERT INTO organizations (id, name, normalized_name, sponsor_tier, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(params.id, params.name, params.name.toLowerCase(), params.sponsorTier ?? null)
    .run();
}

async function seedNonMemberConsortiumSponsorship(params: {
  name: string;
  website?: string | null;
  tier: string;
  pipelineStage?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO sponsorships (id, sponsor_type, non_member_name, non_member_website, tier, pipeline_stage, created_at, updated_at)
     VALUES (?, 'consortium', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), params.name, params.website ?? null, params.tier, params.pipelineStage ?? "active")
    .run();
}

async function seedEvent(params: { id: string; slug: string; name: string }) {
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', datetime('now'), datetime('now'))`,
  )
    .bind(params.id, params.slug, params.name)
    .run();
}

async function seedEventSponsorship(params: {
  eventId: string;
  organizationId?: string | null;
  nonMemberName?: string | null;
  nonMemberWebsite?: string | null;
  tier: string;
  pipelineStage?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO sponsorships (id, sponsor_type, organization_id, non_member_name, non_member_website, event_id, tier, pipeline_stage, created_at, updated_at)
     VALUES (?, 'event', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      crypto.randomUUID(),
      params.organizationId ?? null,
      params.nonMemberName ?? null,
      params.nonMemberWebsite ?? null,
      params.eventId,
      params.tier,
      params.pipelineStage ?? "active",
    )
    .run();
}

const AUSTIN_EVENT_NAME = "Post-Quantum Cryptography Conference Austin 2025";
const AUSTIN_EVENT_SLUG = "pqc-conference-austin-us-2025";

describe("GET /api/v1/sponsors (public consortium + event sponsors)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns only organizations with sponsor_tier set", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Sponsoring Org", sponsorTier: "Diamond" });
    await seedOrganization({ id: crypto.randomUUID(), name: "Plain Member Org", sponsorTier: null });

    const response = await callSponsorsList("https://pkic.org/api/v1/sponsors");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sponsors: Array<{ name: string; tier: string | null }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(body.sponsors).toHaveLength(1);
    expect(body.sponsors[0]).toMatchObject({ name: "Sponsoring Org", tier: "Diamond" });
    expect(body.page).toEqual({ limit: 200, offset: 0, total: 1, hasMore: false });
  });

  it("bounds the result set with ?limit=/?offset= instead of returning everything unbounded", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Org Alpha", sponsorTier: "Gold" });
    await seedOrganization({ id: crypto.randomUUID(), name: "Org Beta", sponsorTier: "Gold" });
    await seedOrganization({ id: crypto.randomUUID(), name: "Org Gamma", sponsorTier: "Gold" });

    const firstPage = await callSponsorsList("https://pkic.org/api/v1/sponsors?limit=2&offset=0");
    const firstBody = (await firstPage.json()) as {
      sponsors: Array<{ name: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstBody.sponsors).toHaveLength(2);
    expect(firstBody.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });

    const secondPage = await callSponsorsList("https://pkic.org/api/v1/sponsors?limit=2&offset=2");
    const secondBody = (await secondPage.json()) as {
      sponsors: Array<{ name: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(secondBody.sponsors).toHaveLength(1);
    expect(secondBody.page).toEqual({ limit: 2, offset: 2, total: 3, hasMore: false });
  });

  it("applies search, tier, minimum weight, and allowlisted sorting in the read model", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Alpha Diamond", sponsorTier: "Diamond" });
    await seedOrganization({ id: crypto.randomUUID(), name: "Beta Gold", sponsorTier: "Gold" });
    await seedOrganization({ id: crypto.randomUUID(), name: "Gamma Diamond", sponsorTier: "Diamond" });

    const filtered = await callSponsorsList(
      "https://pkic.org/api/v1/sponsors?q=diamond&level=Diamond&minWeight=5&sort=name",
    );
    expect(filtered.status).toBe(200);
    const body = (await filtered.json()) as {
      sponsors: Array<{ name: string; effectiveTier: string; weight: number }>;
      page: { total: number };
    };
    expect(body.sponsors.map(({ name, effectiveTier, weight }) => ({ name, effectiveTier, weight }))).toEqual([
      { name: "Alpha Diamond", effectiveTier: "Diamond", weight: 6 },
      { name: "Gamma Diamond", effectiveTier: "Diamond", weight: 6 },
    ]);
    expect(body.page.total).toBe(2);

    const descending = await callSponsorsList(
      "https://pkic.org/api/v1/sponsors?q=diamond&level=Diamond&minWeight=5&sort=-name",
    );
    const descendingBody = (await descending.json()) as { sponsors: Array<{ name: string }> };
    expect(descendingBody.sponsors.map(({ name }) => name)).toEqual(["Gamma Diamond", "Alpha Diamond"]);

    const invalidSort = await callSponsorsList("https://pkic.org/api/v1/sponsors?sort=raw_sql");
    expect(invalidSort.status).toBe(400);
  });

  it("reads public display weights from D1 configuration rather than a browser constant", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Configured Bronze", sponsorTier: "Bronze" });
    try {
      await env.DB.prepare(
        `UPDATE sponsorship_tier_catalog SET display_weight = 7 WHERE sponsor_type = 'consortium' AND tier = 'Bronze'`,
      ).run();

      const response = await callSponsorsList("https://pkic.org/api/v1/sponsors?sort=-weight");
      const body = (await response.json()) as { sponsors: Array<{ name: string; weight: number }> };
      expect(body.sponsors.map(({ name, weight }) => ({ name, weight }))).toEqual([
        { name: "Configured Bronze", weight: 7 },
      ]);
    } finally {
      await env.DB.prepare(
        `UPDATE sponsorship_tier_catalog SET display_weight = 1 WHERE sponsor_type = 'consortium' AND tier = 'Bronze'`,
      ).run();
    }
  });

  it("includes active non-member consortium sponsorships but excludes non-active ones", async () => {
    await seedNonMemberConsortiumSponsorship({
      name: "Active Non-Member Sponsor",
      tier: "Gold",
      pipelineStage: "active",
    });
    await seedNonMemberConsortiumSponsorship({
      name: "Lapsed Non-Member Sponsor",
      tier: "Silver",
      pipelineStage: "lapsed",
    });

    const response = await callSponsorsList("https://pkic.org/api/v1/sponsors");
    const body = (await response.json()) as { sponsors: Array<{ name: string }> };
    expect(body.sponsors.map((s) => s.name)).toEqual(["Active Non-Member Sponsor"]);
  });

  it("drops unsafe legacy sponsor websites at the response mapping boundary", async () => {
    await seedNonMemberConsortiumSponsorship({
      name: "Legacy Unsafe Website",
      website: "javascript:alert(1)",
      tier: "Gold",
    });

    const response = await callSponsorsList("https://pkic.org/api/v1/sponsors");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sponsors: Array<{ website: string | null }> };
    expect(body.sponsors).toHaveLength(1);
    expect(body.sponsors[0]?.website).toBeNull();
  });

  it("merges an org-tied event sponsorship onto the same record as its consortium tier", async () => {
    const orgId = crypto.randomUUID();
    await seedOrganization({ id: orgId, name: "Dual Sponsor Org", sponsorTier: "Titanium" });
    await seedEvent({
      id: crypto.randomUUID(),
      slug: AUSTIN_EVENT_SLUG,
      name: "Post-Quantum Cryptography Conference - Austin 2025",
    });
    const eventRow = await env.DB.prepare(`SELECT id FROM events WHERE slug = ?`)
      .bind(AUSTIN_EVENT_SLUG)
      .first<{ id: string }>();
    await seedEventSponsorship({ eventId: eventRow!.id, organizationId: orgId, tier: "Leader" });

    const response = await callSponsorsList(
      `https://pkic.org/api/v1/sponsors?eventName=${encodeURIComponent(AUSTIN_EVENT_NAME)}`,
    );
    const body = (await response.json()) as {
      sponsors: Array<{ name: string; tier: string | null; eventTier: string | null }>;
    };
    expect(body.sponsors).toHaveLength(1);
    expect(body.sponsors[0]).toMatchObject({ name: "Dual Sponsor Org", tier: "Titanium", eventTier: "Leader" });
  });

  it("uses eventSlug as the canonical identity and keeps eventName as a legacy fallback", async () => {
    const firstEventId = crypto.randomUUID();
    const secondEventId = crypto.randomUUID();
    await seedEvent({ id: firstEventId, slug: "same-name-first", name: "Same Conference" });
    await seedEvent({ id: secondEventId, slug: "same-name-second", name: "Same Conference" });
    await seedEventSponsorship({ eventId: firstEventId, nonMemberName: "First Event Sponsor", tier: "Leader" });
    await seedEventSponsorship({ eventId: secondEventId, nonMemberName: "Second Event Sponsor", tier: "Leader" });

    const canonical = await callSponsorsList("https://pkic.org/api/v1/sponsors?eventSlug=same-name-first");
    const canonicalBody = (await canonical.json()) as { sponsors: Array<{ name: string }> };
    expect(canonicalBody.sponsors.map((s) => s.name)).toEqual(["First Event Sponsor"]);

    const legacy = await callSponsorsList("https://pkic.org/api/v1/sponsors?eventName=Same%20Conference");
    expect(legacy.status).toBe(400);
    const legacyBody = (await legacy.json()) as { error?: { code?: string } };
    expect(legacyBody.error?.code).toBe("AMBIGUOUS_EVENT_NAME");

    const staleSlug = await callSponsorsList(
      "https://pkic.org/api/v1/sponsors?eventSlug=deleted-event&eventName=Same%20Conference",
    );
    const staleSlugBody = (await staleSlug.json()) as { sponsors: unknown[] };
    expect(staleSlugBody.sponsors).toHaveLength(0);
  });

  it("returns bounded server-grouped rows for grid and level displays", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Display Diamond", sponsorTier: "Diamond" });
    await seedOrganization({ id: crypto.randomUUID(), name: "Display Gold", sponsorTier: "Gold" });
    const response = await callSponsorsList("https://pkic.org/api/v1/sponsors/display?limit=1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{ weight: number; tierName: string; sponsors: Array<{ name: string }> }>;
      page: { limit: number; total: number; hasMore: boolean };
    };
    expect(body.page).toMatchObject({ limit: 1, total: 2, hasMore: true });
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.sponsors).toHaveLength(1);
    expect(body.groups[0]?.tierName).toBe("Diamond");
  });

  it("reports the exact total even when a bounded page starts beyond the final row", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "One Sponsor", sponsorTier: "Diamond" });
    const response = await callSponsorsList("https://pkic.org/api/v1/sponsors?limit=2&offset=100");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sponsors: unknown[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(body.sponsors).toHaveLength(0);
    expect(body.page).toEqual({ limit: 2, offset: 100, total: 1, hasMore: false });
  });

  it("runs the sponsor projection and total as one D1 statement", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "One Pass Sponsor", sponsorTier: "Diamond" });
    let prepareCalls = 0;
    const countingDb = {
      ...env.DB,
      prepare(sql: string) {
        prepareCalls += 1;
        return env.DB.prepare(sql);
      },
    };
    const response = await listPublicSponsors(countingDb, { limit: 1, offset: 0 });
    expect(response.page.total).toBe(1);
    expect(prepareCalls).toBe(1);
  });

  it("materializes the filtered projection once for page rows and the total row", async () => {
    const query = buildPublicSponsorPageQuery(
      { limit: 200, offset: 0 },
      { sql: "WHERE effective_weight > 0", bindings: [] },
      "ORDER BY effective_weight DESC, name ASC, id ASC",
    );
    const plan = await env.DB.prepare(query.sql.replace(/^\s*WITH/, "EXPLAIN QUERY PLAN WITH"))
      .bind(...query.bindings)
      .all<{ detail: string }>();
    expect(plan.results.filter(({ detail }) => detail.includes("MATERIALIZE filtered"))).toHaveLength(1);
  });

  it("adds a non-member event sponsor as its own record, separate from any consortium sponsors", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Unrelated Consortium Sponsor", sponsorTier: "Bronze" });
    await seedEvent({
      id: crypto.randomUUID(),
      slug: AUSTIN_EVENT_SLUG,
      name: "Post-Quantum Cryptography Conference - Austin 2025",
    });
    const eventRow = await env.DB.prepare(`SELECT id FROM events WHERE slug = ?`)
      .bind(AUSTIN_EVENT_SLUG)
      .first<{ id: string }>();
    await seedEventSponsorship({
      eventId: eventRow!.id,
      nonMemberName: "Venue Partner",
      nonMemberWebsite: "https://venue.example",
      tier: "Ambassador",
    });

    const response = await callSponsorsList(
      `https://pkic.org/api/v1/sponsors?eventName=${encodeURIComponent(AUSTIN_EVENT_NAME)}`,
    );
    const body = (await response.json()) as {
      sponsors: Array<{ name: string; tier: string | null; eventTier: string | null; website: string | null }>;
    };
    expect(body.sponsors).toHaveLength(2);
    const venue = body.sponsors.find((s) => s.name === "Venue Partner");
    expect(venue).toMatchObject({ tier: null, eventTier: "Ambassador", website: "https://venue.example" });
  });

  it("does not include a lapsed event sponsorship", async () => {
    await seedEvent({
      id: crypto.randomUUID(),
      slug: AUSTIN_EVENT_SLUG,
      name: "Post-Quantum Cryptography Conference - Austin 2025",
    });
    const eventRow = await env.DB.prepare(`SELECT id FROM events WHERE slug = ?`)
      .bind(AUSTIN_EVENT_SLUG)
      .first<{ id: string }>();
    await seedEventSponsorship({
      eventId: eventRow!.id,
      nonMemberName: "Lapsed Event Sponsor",
      tier: "Leader",
      pipelineStage: "lapsed",
    });

    const response = await callSponsorsList(
      `https://pkic.org/api/v1/sponsors?eventName=${encodeURIComponent(AUSTIN_EVENT_NAME)}`,
    );
    const body = (await response.json()) as { sponsors: unknown[] };
    expect(body.sponsors).toHaveLength(0);
  });

  it("falls back to the consortium-only list for an unrecognized eventName", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Consortium Only Sponsor", sponsorTier: "Silver" });

    const response = await callSponsorsList("https://pkic.org/api/v1/sponsors?eventName=Some+Unmapped+Event");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sponsors: Array<{ name: string }> };
    expect(body.sponsors.map((s) => s.name)).toEqual(["Consortium Only Sponsor"]);
  });

  it("sets logoUrl to the members logo route for org-tied sponsors when logo_r2_key is set", async () => {
    const orgId = crypto.randomUUID();
    await seedOrganization({ id: orgId, name: "Logo Org", sponsorTier: "Diamond" });
    await env.DB.prepare(`UPDATE organizations SET logo_r2_key = ? WHERE id = ?`)
      .bind("org-logos/logo-org/logo.png", orgId)
      .run();

    const response = await callSponsorsList("https://pkic.org/api/v1/sponsors");
    const body = (await response.json()) as { sponsors: Array<{ logoUrl: string | null }> };
    expect(body.sponsors[0].logoUrl).toBe(`/api/v1/members/${orgId}/logo`);
  });
});

describe("GET /api/v1/sponsors/:id/logo", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns 404 when the sponsorship has no logo on file", async () => {
    await seedNonMemberConsortiumSponsorship({ name: "No Logo Sponsor", tier: "Gold" });
    const row = await env.DB.prepare(`SELECT id FROM sponsorships WHERE non_member_name = ?`)
      .bind("No Logo Sponsor")
      .first<{ id: string }>();

    const response = await callEndpoint(
      getSponsorLogo,
      createContext(env, getRequest(`https://pkic.org/api/v1/sponsors/${row!.id}/logo`), { id: row!.id }),
    );
    expect(response.status).toBe(404);
  });

  it("serves the logo bytes from R2 when non_member_logo_r2_key is set", async () => {
    await seedNonMemberConsortiumSponsorship({ name: "Logo Sponsor", tier: "Gold" });
    const row = await env.DB.prepare(`SELECT id FROM sponsorships WHERE non_member_name = ?`)
      .bind("Logo Sponsor")
      .first<{ id: string }>();
    const r2Key = `sponsor-logos/logo-sponsor/logo.svg`;
    await env.DB.prepare(`UPDATE sponsorships SET non_member_logo_r2_key = ? WHERE id = ?`).bind(r2Key, row!.id).run();
    const bytes = new Uint8Array([1, 2, 3]);
    await env.ASSETS_BUCKET!.put(r2Key, bytes);

    const response = await callEndpoint(
      getSponsorLogo,
      createContext(env, getRequest(`https://pkic.org/api/v1/sponsors/${row!.id}/logo`), { id: row!.id }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    const buf = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(buf)).toEqual([1, 2, 3]);
  });
});
