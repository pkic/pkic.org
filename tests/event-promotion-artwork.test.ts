import {
  resolvePromotionDesign,
  promotionDesignArtwork,
} from "../functions/_lib/services/event-agenda/promotion-design";
import { defaultEventPromotionDesign } from "../assets/shared/schemas/event-promotion-design";
import { openapi } from "../functions/http-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { promotionFixture, eventBase } from "./helpers/promotion-fixture";
import { callApi } from "./helpers/app";
import { promotionArtworkSchema, promotionKitSchema } from "../assets/shared/schemas/event-promotion-kit";
import type { PromotionRenderData } from "../functions/_lib/services/event-agenda/promotion-render";

// Fonts are static assets; the D1-only runtime has no publication. Keep source, authorization, and layout real.
vi.mock("../functions/_lib/services/event-agenda/promotion-artwork-inputs", () => ({
  preparePromotionArtwork: async (_env: unknown, _origin: string, source: PromotionRenderData) => ({
    faces: [],
    fonts: [],
    source,
  }),
}));

async function brandingSponsor(eventId: string, source: "event" | "consortium", tier: string, stage = "active") {
  const id = crypto.randomUUID(),
    organizationId = crypto.randomUUID(),
    now = new Date().toISOString();
  const key = `org-logos/${organizationId}/logo.svg`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><path d="M10 10H180V40H10Z" fill="#125c3c"/></svg>';
  await env.ASSETS_BUCKET!.put(key, svg, { httpMetadata: { contentType: "image/svg+xml" } });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations(id,name,normalized_name,logo_r2_key,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).bind(organizationId, `Synthetic ${source} ${tier}`, `synthetic-${id}`, key, now, now),
    env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(id, source, organizationId, source === "event" ? eventId : null, tier, stage, now, now),
  ]);
  return { id, organizationId };
}

describe("own promotion artwork", () => {
  beforeEach(() => resetDb());

  it("includes public consortium sponsors in default artwork when the event has no sponsors", async () => {
    const f = await promotionFixture();
    const before = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    await brandingSponsor(f.eventId, "consortium", "Diamond");
    await brandingSponsor(f.eventId, "consortium", "Gold");
    await brandingSponsor(f.eventId, "consortium", "Platinum", "prospect");
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    expect(kit.fingerprint).not.toBe(before.fingerprint);
    const response = await callApi(
      env,
      `${f.sessionBase}/artifact?format=carousel&revision=${kit.publishedRevision}&fingerprint=${kit.fingerprint}&representation=artwork&pages=all`,
      { headers: f.headers },
      { maxRoundTrips: 1 },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const artwork = promotionArtworkSchema.parse(await response.json());
    const board = artwork.pages.find((page) => page.svg.includes('aria-label="Our sponsors"'));
    expect(board).toBeDefined();
    expect(board!.svg).toContain("PKI CONSORTIUM");
    const branding = await promotionDesignArtwork(env, await resolvePromotionDesign(env.DB, f.eventId));
    expect(branding.sponsors.map((group) => group.tierName)).toEqual(["Diamond", "Gold"]);
  });

  it("keeps every populated event and consortium tier and honors explicit selections", async () => {
    const f = await promotionFixture();
    for (const tier of ["Leader", "Inspirator", "Innovator", "Ambassador"])
      await brandingSponsor(f.eventId, "event", tier);
    for (const tier of ["Diamond", "Titanium", "Platinum", "Gold", "Silver", "Bronze"])
      await brandingSponsor(f.eventId, "consortium", tier);
    const visual = await resolvePromotionDesign(env.DB, f.eventId);
    expect(visual.design.sponsorGroups).toHaveLength(10);
    const all = await promotionDesignArtwork(env, visual);
    expect(all.sponsors.flatMap((group) => group.sponsors)).toHaveLength(10);
    await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
      .bind(
        JSON.stringify({
          promotionDesign: {
            ...defaultEventPromotionDesign("Selected sponsors"),
            sponsorSource: "selected",
            sponsorGroups: [{ key: "diamond", source: "consortium", tierName: "Diamond" }],
          },
        }),
        f.eventId,
      )
      .run();
    const selected = await promotionDesignArtwork(env, await resolvePromotionDesign(env.DB, f.eventId));
    expect(selected.sponsors.map((group) => group.tierName)).toEqual(["Diamond"]);
    await env.DB.prepare(
      "UPDATE events SET settings_json=json_set(settings_json,'$.promotionDesign.sponsorGroups',json('[]')) WHERE id=?",
    )
      .bind(f.eventId)
      .run();
    expect((await promotionDesignArtwork(env, await resolvePromotionDesign(env.DB, f.eventId))).sponsors).toEqual([]);
  });

  it("shows a dual sponsor once under its event tier in automatic materials", async () => {
    const f = await promotionFixture();
    const sponsor = await brandingSponsor(f.eventId, "consortium", "Diamond");
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,'Leader','active',?,?)",
    )
      .bind(crypto.randomUUID(), sponsor.organizationId, f.eventId, now, now)
      .run();
    await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
      .bind(JSON.stringify({ promotionDesign: defaultEventPromotionDesign("Automatic sponsors") }), f.eventId)
      .run();
    const branding = await promotionDesignArtwork(env, await resolvePromotionDesign(env.DB, f.eventId));
    expect(branding.sponsors.map((group) => [group.tierName, group.sponsors.length])).toEqual([["Leader", 1]]);
  });

  it("documents participant reads without declaring delegated personal writes", () => {
    const paths = openapi.schema.paths;
    const read = paths["/api/v1/events/{eventSlug}/promotion"].get;
    const write = paths["/api/v1/events/{eventSlug}/promotion/composition"].post;
    expect(read.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "userId", in: "query" })]));
    expect(write.parameters).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "userId", in: "query" })]),
    );
  });

  it("serves current SVG pages without queueing or reading a rendered file, in one D1 round trip", async () => {
    const f = await promotionFixture();
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const path = `${f.sessionBase}/artifact?format=portrait&revision=${kit.publishedRevision}&fingerprint=${kit.fingerprint}&representation=artwork`;
    const response = await callApi(env, path, { headers: f.headers }, { maxRoundTrips: 1 });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const artwork = promotionArtworkSchema.parse(await response.json());
    expect(artwork.pages[0]?.svg).toContain("<svg");
    expect(artwork.pages.some((page) => page.svg.includes("Planning a quantum-safe migration"))).toBe(true);
    expect(artwork.pages[0]).toMatchObject({ width: 1080, height: 1350 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_promotion_renders").first("count")).toBe(0);
    const notReady = await callApi(env, path.replace("representation=artwork", "representation=file"), {
      headers: f.headers,
    });
    expect(notReady.status).toBe(409);
  });

  it("refuses another attendee's session and stale fingerprints before preparing artwork", async () => {
    const f = await promotionFixture();
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const path = `${f.sessionBase}/artifact?format=carousel&revision=${kit.publishedRevision}&fingerprint=${kit.fingerprint}&representation=artwork`;
    const refused = await callApi(env, path, { headers: f.attendeeHeaders }, { maxRoundTrips: 1 });
    expect(refused.status).toBe(403);
    const stale = await callApi(
      env,
      path.replace(kit.fingerprint!, "f".repeat(64)),
      { headers: f.headers },
      { maxRoundTrips: 1 },
    );
    expect(stale.status).toBe(409);
    const cover = await callApi(env, path, { headers: f.headers }, { maxRoundTrips: 1 });
    expect(cover.status).toBe(200);
    expect(promotionArtworkSchema.parse(await cover.json()).pages).toHaveLength(1);
    const full = await callApi(env, `${path}&pages=all`, { headers: f.headers }, { maxRoundTrips: 1 });
    expect(full.status).toBe(200);
    expect(promotionArtworkSchema.parse(await full.json()).pages.length).toBeGreaterThan(1);
    const refusedFull = await callApi(env, `${path}&pages=all`, { headers: f.attendeeHeaders }, { maxRoundTrips: 1 });
    expect(refusedFull.status).toBe(403);
  });
  it("refuses stale or unauthorized PDF exports without queue jobs", async () => {
    const f = await promotionFixture();
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const body = {
      fingerprint: kit.fingerprint,
      publishedRevision: kit.publishedRevision,
      compositionRevision: kit.compositionRevision,
    };
    const path = `${f.sessionBase}/artifact`;
    const stale = await callApi(
      env,
      path,
      {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({ ...body, compositionRevision: body.compositionRevision + 1 }),
      },
      { maxRoundTrips: 1 },
    );
    expect(stale.status).toBe(409);
    const refused = await callApi(
      env,
      path,
      { method: "POST", headers: f.attendeeHeaders, body: JSON.stringify(body) },
      { maxRoundTrips: 1 },
    );
    expect(refused.status).toBe(403);
  });
  it("lets an event organizer open the participant's exact attendee and speaker materials", async () => {
    const f = await promotionFixture(true);
    const event = await callApi(env, eventBase, { headers: f.headers });
    expect(event.status).toBe(200);
    expect(await event.json()).toMatchObject({ event: { participation: { speakerSessions: 1 } } });
    const own = promotionKitSchema.parse(
      await (await callApi(env, `${eventBase}/promotion`, { headers: f.attendeeHeaders })).json(),
    );
    const delegated = await callApi(
      env,
      `${eventBase}/promotion?userId=${f.userId}`,
      { headers: f.headers },
      { maxRoundTrips: 1 },
    );
    expect(delegated.status, await delegated.clone().text()).toBe(200);
    expect(promotionKitSchema.parse(await delegated.json())).toEqual(own);
    const artwork = await callApi(
      env,
      `${eventBase}/promotion/artifact?userId=${f.userId}&format=portrait&revision=${own.publishedRevision}&fingerprint=${own.fingerprint}&representation=artwork`,
      { headers: f.headers },
      { maxRoundTrips: 1 },
    );
    expect(artwork.status, await artwork.clone().text()).toBe(200);
    expect(promotionArtworkSchema.parse(await artwork.json()).pages[0]?.svg).toContain("Example Attendee");
    const initialized = await callApi(
      env,
      `${f.sessionBase}/referrals?userId=${f.secondSpeaker!.id}`,
      { method: "POST", headers: f.headers, body: "{}" },
      { maxRoundTrips: 1 },
    );
    expect(initialized.status, await initialized.clone().text()).toBe(200);
    const speakerKit = promotionKitSchema.parse(await initialized.json());
    const read = await callApi(
      env,
      `${f.sessionBase}?userId=${f.secondSpeaker!.id}`,
      { headers: f.headers },
      { maxRoundTrips: 1 },
    );
    expect(read.status, await read.clone().text()).toBe(200);
    expect(promotionKitSchema.parse(await read.json())).toEqual(speakerKit);
    const list = await callApi(
      env,
      `${eventBase}/agenda/promotion?userId=${f.secondSpeaker!.id}`,
      { headers: f.headers },
      { maxRoundTrips: 1 },
    );
    expect(list.status, await list.clone().text()).toBe(200);
    expect(await list.json()).toMatchObject({ attendeeEligible: false, occurrences: [{ id: f.sessionId }] });
  });

  it("refuses another participant without event-scoped management authority, including initialization and PDFs", async () => {
    const f = await promotionFixture(true);
    const codesBefore = await env.DB.prepare("SELECT COUNT(*) AS count FROM referral_codes").first("count");
    for (const [path, method, body] of [
      [`${f.sessionBase}?userId=${f.admin.id}`, "GET", undefined],
      [`${eventBase}/agenda/promotion?userId=${f.admin.id}`, "GET", undefined],
      [`${f.sessionBase}/referrals?userId=${f.secondSpeaker!.id}`, "POST", "{}"],
      [`${eventBase}/promotion?userId=${f.admin.id}`, "GET", undefined],
    ] as const) {
      const response = await callApi(env, path, { method, headers: f.attendeeHeaders, body }, { maxRoundTrips: 1 });
      expect(response.status, await response.clone().text()).toBe(403);
    }
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const refusedPdf = await callApi(
      env,
      `${f.sessionBase}/artifact?userId=${f.admin.id}`,
      {
        method: "POST",
        headers: f.attendeeHeaders,
        body: JSON.stringify({
          fingerprint: kit.fingerprint,
          publishedRevision: kit.publishedRevision,
          compositionRevision: kit.compositionRevision,
        }),
      },
      { maxRoundTrips: 1 },
    );
    expect(refusedPdf.status).toBe(403);
    const unassigned = await callApi(
      env,
      `${f.sessionBase}/referrals?userId=${f.userId}`,
      { method: "POST", headers: f.headers, body: "{}" },
      { maxRoundTrips: 1 },
    );
    expect(unassigned.status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM referral_codes").first("count")).toBe(codesBefore);
    const editOther = await callApi(
      env,
      `${f.sessionBase}/composition?userId=${f.admin.id}`,
      {
        method: "POST",
        headers: f.attendeeHeaders,
        body: JSON.stringify({ expectedRevision: kit.compositionRevision, composition: kit.composition }),
      },
      { maxRoundTrips: 1 },
    );
    expect(editOther.status).toBe(400);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES('unrelated-event','unrelated-event','Other event','UTC','invite_or_open','{}',?,?)",
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'events:manage','event',?,?)",
    )
      .bind(crypto.randomUUID(), f.userId, "unrelated-event", now)
      .run();
    const wrongEvent = await callApi(
      env,
      `${f.sessionBase}?userId=${f.admin.id}`,
      { headers: f.attendeeHeaders },
      { maxRoundTrips: 1 },
    );
    expect(wrongEvent.status).toBe(403);
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'events:manage','event',?,?)",
    )
      .bind(crypto.randomUUID(), f.userId, f.eventId, now)
      .run();
    const allowed = await callApi(
      env,
      `${f.sessionBase}?userId=${f.admin.id}`,
      { headers: f.attendeeHeaders },
      { maxRoundTrips: 1 },
    );
    expect(allowed.status, await allowed.clone().text()).toBe(200);
  });
});
