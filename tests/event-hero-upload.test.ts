import { profileD1Flow } from "./helpers/d1-flow-profile";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { insertOrgRepresentative } from "./helpers/membership";
import { validPngBytes, validWebpBytes } from "./helpers/raster-images";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { eventManagementDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { eventHeroImageSaveSchema } from "../assets/shared/schemas/event-hero-image";
import { fetchHeroImage } from "../functions/_lib/services/og-badge-hero-image";

const context = { waitUntil: () => {}, passThroughOnException: () => {} };
const groupId = "20000000-0000-4000-8000-000000000003";

async function fixture() {
  const seeded = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, seeded.admin.id, crypto.randomUUID());
  const revision = await env.DB.prepare("SELECT updated_at FROM events WHERE id=?")
    .bind(seeded.eventId)
    .first<{ updated_at: string }>();
  return { ...seeded, token, revision: revision!.updated_at };
}

async function upload(
  token: string,
  revision: string,
  options: {
    groupId?: string;
    name?: string;
    bytes?: Uint8Array<ArrayBuffer>;
    type?: string;
    slug?: string;
    confirmSlugChange?: boolean;
  } = {},
  environment: typeof env = env,
) {
  const { bytes = validPngBytes(1200, 630), type = "image/png", ...settings } = options;
  const query = eventHeroImageSaveSchema.parse({ expectedUpdatedAt: revision, ...settings });
  return app.fetch(
    new Request(
      `https://app.test/api/v1/events/pqc-2026/images/hero?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": type },
        body: bytes,
      },
    ),
    environment,
    context as any,
  );
}

async function saved(response: Response) {
  expect(response.status, await response.clone().text()).toBe(200);
  return eventManagementDetailResponseSchema.parse(await response.json()).event;
}

describe("event hero uploads", () => {
  beforeEach(resetDb);

  it("preserves a linked image from another event when this event is renamed", async () => {
    const { token, revision } = await fixture();
    const foreignHero = "/api/v1/events/another-conference/images/00000000-0000-4000-8000-000000000001.png";
    const patch = (slug: string, body: object) =>
      app.fetch(
        new Request(`https://app.test/api/v1/events/${slug}/settings`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        context as any,
      );
    const linked = await saved(await patch("pqc-2026", { expectedUpdatedAt: revision, heroImageUrl: foreignHero }));
    const renamed = await saved(
      await patch("pqc-2026", {
        expectedUpdatedAt: linked.updatedAt,
        slug: "renamed-conference",
        confirmSlugChange: true,
      }),
    );
    expect(renamed.heroImageUrl).toBe(foreignHero);
  });

  it("bounds a complete upload to the authenticated read, durable upload registration, and atomic commit", async () => {
    const { token, revision } = await fixture();
    const profile = profileD1Flow(env.DB);
    await saved(await upload(token, revision, {}, { ...env, DB: profile.db }));
    expect(profile.summary().roundTrips).toBe(3);
  });

  it("saves image and general settings together, serves the current version, and embeds it in promotional graphics", async () => {
    const { token, revision } = await fixture();
    const event = await saved(await upload(token, revision, { name: "Updated conference" }));
    expect(event.name).toBe("Updated conference");
    expect(event.capabilities).toContain("manage");
    const image = await app.fetch(new Request(`https://app.test${event.heroImageUrl}`), env, context as any);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(validPngBytes(1200, 630));
    expect(
      (
        await fetchHeroImage(JSON.stringify({ heroImageUrl: event.heroImageUrl }), "https://app.test", {
          ...env,
          IMAGES: undefined,
        })
      )?.dataUrl,
    ).toMatch(/^data:image\/png;base64,/);
    const replaced = await saved(await upload(token, event.updatedAt));
    expect(replaced.heroImageUrl).not.toBe(event.heroImageUrl);
    expect((await app.fetch(new Request(`https://app.test${event.heroImageUrl}`), env, context as any)).status).toBe(
      404,
    );
    const cleanup = await env.DB.prepare(
      "SELECT object_key FROM storage_deletion_outbox WHERE bucket='assets' AND status='queued'",
    ).all();
    expect(cleanup.results).toHaveLength(1);
  });

  it("rolls back a stale save and cleans up the attempted upload", async () => {
    const { token, revision } = await fixture();
    const current = await saved(await upload(token, revision));
    expect((await upload(token, revision, { name: "Stale name" })).status).toBe(409);
    const row = await env.DB.prepare("SELECT name,settings_json FROM events WHERE id=?")
      .bind(current.id)
      .first<{ name: string; settings_json: string }>();
    expect(row!.name).toBe(current.name);
    expect(JSON.parse(row!.settings_json).heroImageUrl).toBe(current.heroImageUrl);
    const objects = await env.ASSETS_BUCKET!.list({ prefix: `event-images/${current.id}/` });
    expect(objects.objects).toHaveLength(1);
  });

  it.each([
    ["image/png", new TextEncoder().encode("not an image"), 415],
    ["image/jpeg", validPngBytes(), 415],
    ["image/png", validPngBytes(5000, 5000), 413],
    ["image/png", new Uint8Array(5 * 1024 * 1024 + 1), 413],
  ] as const)("rejects invalid images before activation (%s, %i)", async (type, bytes, status) => {
    const { token, revision } = await fixture();
    expect((await upload(token, revision, { type, bytes })).status).toBe(status);
  });

  it.each([
    [600, 315],
    [1200, 1200],
    [1200, 1800],
  ])("rejects insufficient resolution or the wrong aspect ratio (%i × %i)", async (width, height) => {
    const { token, revision } = await fixture();
    const response = await upload(token, revision, { bytes: validPngBytes(width, height) });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", details: { fieldErrors: { file: expect.any(Array) } } },
    });
  });

  it("accepts a higher-resolution landscape image", async () => {
    const { token, revision } = await fixture();
    await saved(await upload(token, revision, { bytes: validPngBytes(2400, 1260) }));
  });

  it("denies ordinary members and allows an owning group leader only through the exact group context", async () => {
    const { eventId, revision } = await fixture();
    await env.DB.prepare("UPDATE events SET owner_group_id=?,source_mode='portal',profile_key='conference' WHERE id=?")
      .bind(groupId, eventId)
      .run();
    const member = await insertOrgRepresentative(env.DB, { category: "A" });
    const memberToken = await createMemberSession(env.DB, member.userId, crypto.randomUUID());
    expect((await upload(memberToken, revision, { groupId })).status).toBe(403);
    await grantGroupLeadershipCapacity(env.DB, groupId, member.userId);
    const leaderToken = await createAdminSession(env.DB, member.userId, crypto.randomUUID());
    expect((await upload(leaderToken, revision)).status).toBe(403);
    const event = await saved(await upload(leaderToken, revision, { groupId }));
    expect(event.heroImageUrl).toContain("/images/");
    expect(
      (await upload(leaderToken, event.updatedAt, { groupId: "20000000-0000-4000-8000-000000000001" })).status,
    ).toBe(403);
  });

  it("preserves an uploaded image when renaming an event, and queues cleanup on removal", async () => {
    const { token, revision } = await fixture();
    const event = await saved(await upload(token, revision));
    const patch = (slug: string, body: unknown) =>
      app.fetch(
        new Request(`https://app.test/api/v1/events/${slug}/settings`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        context as any,
      );
    const renamed = await saved(
      await patch(event.slug, { expectedUpdatedAt: event.updatedAt, slug: "new-conference", confirmSlugChange: true }),
    );
    expect(renamed.heroImageUrl).toContain("/new-conference/images/");
    expect((await app.fetch(new Request(`https://app.test${renamed.heroImageUrl}`), env, context as any)).status).toBe(
      200,
    );
    await saved(await patch(renamed.slug, { expectedUpdatedAt: renamed.updatedAt, heroImageUrl: null }));
    expect((await app.fetch(new Request(`https://app.test${renamed.heroImageUrl}`), env, context as any)).status).toBe(
      404,
    );
  });
});

describe("event hero display renditions", () => {
  beforeEach(resetDb);
  it("serves and reuses a bounded WebP while checking the current image before releasing cached bytes", async () => {
    const { token, revision } = await fixture();
    const event = await saved(await upload(token, revision));
    const transform = vi.fn(() => ({
      output: vi.fn(async () => ({ response: () => new Response(validWebpBytes(600, 315)) })),
    }));
    const images = { input: vi.fn(() => ({ transform })) };
    const request = (address: string) =>
      app.fetch(new Request(`https://app.test${address}`), { ...env, IMAGES: images }, context as any);
    const address = `${event.heroImageUrl}?width=600`;
    const response = await request(address);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(validWebpBytes(600, 315));
    const repeat = await request(address);
    expect(repeat.status).toBe(200);
    expect(new Uint8Array(await repeat.arrayBuffer())).toEqual(validWebpBytes(600, 315));
    expect(transform).toHaveBeenCalledExactlyOnceWith({ width: 600, fit: "scale-down" });
    await saved(await upload(token, event.updatedAt));
    expect((await request(address)).status).toBe(404);
    expect(transform).toHaveBeenCalledTimes(1);
  });
  it("keeps the stored image available when the optimization binding fails or is unavailable", async () => {
    const { token, revision } = await fixture();
    const event = await saved(await upload(token, revision));
    const read = (images: typeof env.IMAGES) =>
      app.fetch(
        new Request(`https://app.test${event.heroImageUrl}?width=1200`),
        { ...env, IMAGES: images },
        context as any,
      );
    for (const images of [
      undefined,
      {
        input: () => {
          throw new Error("Images unavailable");
        },
      },
    ]) {
      const response = await read(images);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(validPngBytes(1200, 630));
    }
  });
  it("rejects unsupported sizes instead of creating unbounded image variants", async () => {
    const { token, revision } = await fixture();
    const event = await saved(await upload(token, revision));
    const response = await app.fetch(
      new Request(`https://app.test${event.heroImageUrl}?width=10000`),
      env,
      context as any,
    );
    expect(response.status).toBe(400);
  });
});
