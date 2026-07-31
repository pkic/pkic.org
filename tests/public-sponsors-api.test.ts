import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestGet as listSponsors } from "../functions/api/v1/sponsors/index";
import { onRequestGet as getSponsorLogo } from "../functions/api/v1/sponsors/[id]/logo";

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

    const response = await callEndpoint(
      listSponsors,
      createContext(env, getRequest("https://pkic.org/api/v1/sponsors"), {}),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sponsors: Array<{ name: string; tier: string | null }> };
    expect(body.sponsors).toHaveLength(1);
    expect(body.sponsors[0]).toMatchObject({ name: "Sponsoring Org", tier: "Diamond" });
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

    const response = await callEndpoint(
      listSponsors,
      createContext(env, getRequest("https://pkic.org/api/v1/sponsors"), {}),
    );
    const body = (await response.json()) as { sponsors: Array<{ name: string }> };
    expect(body.sponsors.map((s) => s.name)).toEqual(["Active Non-Member Sponsor"]);
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

    const response = await callEndpoint(
      listSponsors,
      createContext(
        env,
        getRequest(`https://pkic.org/api/v1/sponsors?eventName=${encodeURIComponent(AUSTIN_EVENT_NAME)}`),
        {},
      ),
    );
    const body = (await response.json()) as {
      sponsors: Array<{ name: string; tier: string | null; eventTier: string | null }>;
    };
    expect(body.sponsors).toHaveLength(1);
    expect(body.sponsors[0]).toMatchObject({ name: "Dual Sponsor Org", tier: "Titanium", eventTier: "Leader" });
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

    const response = await callEndpoint(
      listSponsors,
      createContext(
        env,
        getRequest(`https://pkic.org/api/v1/sponsors?eventName=${encodeURIComponent(AUSTIN_EVENT_NAME)}`),
        {},
      ),
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

    const response = await callEndpoint(
      listSponsors,
      createContext(
        env,
        getRequest(`https://pkic.org/api/v1/sponsors?eventName=${encodeURIComponent(AUSTIN_EVENT_NAME)}`),
        {},
      ),
    );
    const body = (await response.json()) as { sponsors: unknown[] };
    expect(body.sponsors).toHaveLength(0);
  });

  it("falls back to the consortium-only list for an unrecognized eventName", async () => {
    await seedOrganization({ id: crypto.randomUUID(), name: "Consortium Only Sponsor", sponsorTier: "Silver" });

    const response = await callEndpoint(
      listSponsors,
      createContext(env, getRequest("https://pkic.org/api/v1/sponsors?eventName=Some+Unmapped+Event"), {}),
    );
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

    const response = await callEndpoint(
      listSponsors,
      createContext(env, getRequest("https://pkic.org/api/v1/sponsors"), {}),
    );
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
    const buf = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(buf)).toEqual([1, 2, 3]);
  });
});
