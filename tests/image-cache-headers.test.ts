/**
 * How the Worker lets browsers and the edge keep the images the live studio,
 * its outputs, chat and the virtual room draw: each address names the file it
 * shows, so a cache may keep it for a year, a revalidation is a 304 that
 * reads no image, and an image that is not public is never kept by a shared
 * cache.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { insertOrganization, insertUser } from "./helpers/membership";
import { validJpegBytes } from "./helpers/raster-images";
import { resetDb } from "./helpers/reset-db";

const YEAR_PUBLIC = "public, max-age=31536000, immutable";
const PORTRAIT = "public, max-age=31536000, s-maxage=300, immutable";
const LOGO_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
);

const get = (path: string, headers: Record<string, string> = {}) => callApi(env, path, { headers });

async function sponsorship(listed: boolean) {
  const id = crypto.randomUUID();
  const key = `sponsor-logos/${id}/${crypto.randomUUID()}.svg`;
  await env.DB.prepare(
    `INSERT INTO sponsorships (id, sponsor_type, non_member_name, tier, pipeline_stage, non_member_logo_r2_key, created_at, updated_at)
     VALUES (?, 'consortium', 'Example Sponsor', 'gold', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, listed ? "active" : "prospect", key)
    .run();
  await env.ASSETS_BUCKET!.put(key, LOGO_SVG);
  return { id, version: key.split("/").pop()! };
}

beforeEach(async () => {
  await resetDb();
});

describe("image cache headers", () => {
  it("keeps a portrait a year in browsers, rechecks it at the edge, and answers a recheck with a 304", async () => {
    const userId = await insertUser(env.DB);
    const key = `headshots/${userId}/2026-10-14T10-00-00-000Z-abcd1234.jpg`;
    await env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?").bind(key, userId).run();
    await env.SPEAKER_UPLOADS_BUCKET!.put(key, validJpegBytes(64, 64));
    const path = `/api/v1/users/${userId}/headshots/${key.split("/").pop()}`;
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(PORTRAIT);
    const tag = response.headers.get("etag");
    expect(tag).toBe(`"${key.split("/").pop()}"`);
    const unchanged = await get(path, { "if-none-match": tag! });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("cache-control")).toBe(PORTRAIT);
    // Removed, the address stops resolving even for a cache that still holds its tag.
    await env.DB.prepare("UPDATE users SET headshot_r2_key=NULL WHERE id=?").bind(userId).run();
    expect((await get(path, { "if-none-match": tag! })).status).toBe(404);
  });

  it("caches an organization logo a year at its versioned address, and a stale version no longer resolves", async () => {
    const organizationId = await insertOrganization(env.DB, "Example Org");
    const key = `org-logos/${organizationId}/first.svg`;
    await env.DB.prepare("UPDATE organizations SET logo_r2_key=? WHERE id=?").bind(key, organizationId).run();
    await env.ASSETS_BUCKET!.put(key, LOGO_SVG);
    const versioned = await get(`/api/v1/members/${organizationId}/logo?v=first.svg`);
    expect(versioned.status).toBe(200);
    expect(versioned.headers.get("cache-control")).toBe(YEAR_PUBLIC);
    expect(versioned.headers.get("etag")).toBe('"first.svg"');
    expect(
      (await get(`/api/v1/members/${organizationId}/logo?v=first.svg`, { "if-none-match": '"first.svg"' })).status,
    ).toBe(304);
    // The bare address is still served, without a year's promise.
    expect((await get(`/api/v1/members/${organizationId}/logo`)).headers.get("cache-control")).not.toContain(
      "immutable",
    );
    await env.DB.prepare("UPDATE organizations SET logo_r2_key=? WHERE id=?")
      .bind(`org-logos/${organizationId}/second.svg`, organizationId)
      .run();
    expect((await get(`/api/v1/members/${organizationId}/logo?v=first.svg`)).status).toBe(404);
    expect((await get(`/api/v1/members/${organizationId}/logo?v=..%2Fkey`)).status).toBe(400);
  });

  it("caches a listed sponsor's logo publicly, and an unlisted one only privately for staff", async () => {
    const listed = await sponsorship(true);
    const shown = await get(`/api/v1/sponsors/${listed.id}/logo?v=${listed.version}`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("cache-control")).toBe(YEAR_PUBLIC);

    const hidden = await sponsorship(false);
    const anonymous = await get(`/api/v1/sponsors/${hidden.id}/logo?v=${hidden.version}`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control") ?? "").not.toContain("public");
    const staffId = await insertUser(env.DB);
    await grantAdministrator(env.DB, staffId);
    const token = await createAdminSession(env.DB, staffId, crypto.randomUUID());
    const staff = await get(`/api/v1/sponsors/${hidden.id}/logo?v=${hidden.version}`, {
      authorization: `Bearer ${token}`,
    });
    expect(staff.status).toBe(200);
    // Never stored by a shared cache: the response leaves the Worker marked no-store, not public.
    expect(staff.headers.get("cache-control")).toContain("no-store");
    expect(staff.headers.get("cache-control")).not.toContain("public");
  });
});
