import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { promotionFixture } from "./helpers/promotion-fixture";
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

describe("own promotion artwork", () => {
  beforeEach(() => resetDb());

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
});
