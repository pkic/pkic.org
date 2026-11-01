import { prepareBadgeRenderJob } from "../functions/_lib/services/badge-render-job-statements";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { promotionFixture } from "./helpers/promotion-fixture";
import { promotionKitSchema } from "../assets/shared/schemas/event-promotion-kit";
import { promotionIsOpen, promotionIsRetained } from "../assets/shared/promotion-retention";
import { getPromotionKit } from "../functions/_lib/services/event-agenda/promotion-source";
import {
  processPromotionRenderJob,
  requestPromotionRender,
} from "../functions/_lib/services/event-agenda/promotion-render-jobs";
import { purgeExpiredPromotionFiles } from "../functions/_lib/services/event-agenda/promotion-retention";
import { promotionThumbnailKey } from "../functions/_lib/services/event-agenda/promotion-storage";

const rendered = async () => ({
  body: new TextEncoder().encode("%PDF-1.7 synthetic"),
  contentType: "application/pdf",
  count: 1,
  thumbnail: { bytes: new Uint8Array([9]), contentType: "image/webp" },
});
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
async function endEvent(eventId: string, days: number) {
  await env.DB.prepare("UPDATE events SET starts_at=?,ends_at=? WHERE id=?")
    .bind(daysAgo(days + 1), daysAgo(days), eventId)
    .run();
}

describe("promotion retention", () => {
  beforeEach(() => resetDb());

  it("closes sharing when the event ends and keeps files for thirty days", () => {
    const at = Date.parse("2026-12-10T00:00:00.000Z");
    const event = { startsAt: "2026-12-01T08:00:00.000Z", endsAt: "2026-12-03T18:00:00.000Z" };
    expect(promotionIsOpen(event, Date.parse("2026-12-02T00:00:00.000Z"))).toBe(true);
    expect(promotionIsOpen(event, at)).toBe(false);
    expect(promotionIsRetained(event, at)).toBe(true);
    expect(promotionIsRetained(event, Date.parse("2027-01-03T00:00:00.000Z"))).toBe(false);
    expect(promotionIsRetained({ startsAt: null, endsAt: null }, at)).toBe(true);
  });

  it("serves a thumbnail preview and removes the files a new version replaces", async () => {
    const f = await promotionFixture();
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const queued = await callApi(env, `${f.sessionBase}/renders`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        fingerprint: kit.fingerprint,
        publishedRevision: kit.publishedRevision,
        compositionRevision: kit.compositionRevision,
        formats: ["carousel"],
      }),
    });
    expect(queued.status, await queued.clone().text()).toBe(200);
    const job = (await env.DB.prepare("SELECT id FROM event_promotion_renders WHERE user_id=? AND format='carousel'")
      .bind(f.admin.id)
      .first<{ id: string }>())!;
    const earlier = { id: crypto.randomUUID(), key: "promotion/v7/earlier.pdf" };
    await env.DB.prepare(
      "INSERT INTO event_promotion_renders(id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,status,next_attempt_at,created_at,updated_at) SELECT ?,event_id,occurrence_id,user_id,revision,?,format,origin,?,'rendered',next_attempt_at,created_at,updated_at FROM event_promotion_renders WHERE id=?",
    )
      .bind(earlier.id, "b".repeat(64), earlier.key, job.id)
      .run();
    await env.ASSETS_BUCKET!.put(earlier.key, "old");
    await env.ASSETS_BUCKET!.put(`${earlier.key}.preview.png`, "old");

    expect(await processPromotionRenderJob(env.DB, env, job.id, rendered)).toBe(true);
    expect(await env.ASSETS_BUCKET!.get(earlier.key)).toBeNull();
    expect(await env.ASSETS_BUCKET!.get(`${earlier.key}.preview.png`)).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 AS found FROM event_promotion_renders WHERE id=?").bind(earlier.id).first(),
    ).toBeNull();

    const preview = await callApi(
      env,
      `${f.sessionBase}/artifact?format=carousel&revision=${kit.publishedRevision}&fingerprint=${kit.fingerprint}&download=false`,
      { headers: f.headers },
    );
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(preview.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array([9]));
  });

  it("refuses new renders and retires queued ones once the event has ended", async () => {
    const f = await promotionFixture();
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const source = await getPromotionKit(env.DB, f.eventId, f.sessionId, f.admin.id, "https://example.test");
    const job = await requestPromotionRender(env.DB, f.eventId, source, "square", "https://example.test");
    await endEvent(f.eventId, 1);
    const refused = await callApi(env, `${f.sessionBase}/renders`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({
        fingerprint: kit.fingerprint,
        publishedRevision: kit.publishedRevision,
        compositionRevision: kit.compositionRevision,
        formats: ["portrait"],
      }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("PROMOTION_CLOSED");
    let called = false;
    await processPromotionRenderJob(env.DB, env, job.id, async () => {
      called = true;
      return rendered();
    });
    expect(called).toBe(false);
    expect(
      await env.DB.prepare("SELECT status FROM event_promotion_renders WHERE id=?").bind(job.id).first("status"),
    ).toBe("obsolete");
  });

  it("removes promotion files and badges thirty days after an event, in bounded passes", async () => {
    const f = await promotionFixture();
    const source = await getPromotionKit(env.DB, f.eventId, f.sessionId, f.admin.id, "https://example.test");
    const job = await requestPromotionRender(env.DB, f.eventId, source, "carousel", "https://example.test");
    await processPromotionRenderJob(env.DB, env, job.id, rendered);
    const code = (await env.DB.prepare("SELECT code FROM referral_codes WHERE event_id=? LIMIT 1")
      .bind(f.eventId)
      .first<string>("code"))!;
    const badge = prepareBadgeRenderJob(env.DB, code);
    await badge.statement.run();
    await env.DB.prepare("UPDATE event_promotion_renders SET status='rendered' WHERE id=?").bind(badge.id).run();
    await env.ASSETS_BUCKET!.put(`og-badges/${code}`, "badge");
    await env.ASSETS_BUCKET!.put(`og-badges/${code}/square`, "badge");
    await env.ASSETS_BUCKET!.put(`og-badges/${code}.thumb`, "badge");

    await endEvent(f.eventId, 29);
    expect(await purgeExpiredPromotionFiles(env.DB, env)).toEqual({ renders: 0 });

    await endEvent(f.eventId, 31);
    expect(await purgeExpiredPromotionFiles(env.DB, env, 1)).toEqual({ renders: 1 });
    expect(await purgeExpiredPromotionFiles(env.DB, env, 1)).toEqual({ renders: 1 });
    expect(await purgeExpiredPromotionFiles(env.DB, env, 1)).toEqual({ renders: 0 });
    expect(await env.ASSETS_BUCKET!.get(job.cache_key)).toBeNull();
    expect(await env.ASSETS_BUCKET!.get(promotionThumbnailKey(job.cache_key))).toBeNull();
    expect(await env.ASSETS_BUCKET!.get(`og-badges/${code}`)).toBeNull();
    expect(await env.ASSETS_BUCKET!.get(`og-badges/${code}/square`)).toBeNull();
    expect(await env.ASSETS_BUCKET!.get(`og-badges/${code}.thumb`)).toBeNull();
  });
});
