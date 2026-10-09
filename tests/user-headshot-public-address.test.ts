/**
 * The address a stored headshot is published at, and what that address serves.
 *
 * Two writers put keys in `users.headshot_r2_key`. An upload writes
 * `headshots/<userId>/<timestamp>-<nonce>.<ext>`; the member migration writes
 * `member-photos/<orgSlug>/<file>` for a portrait it carried over from the
 * repository (scripts/migrate-members/individuals.mjs). The address used to be
 * derived by reading the owner out of the key, which only ever worked for the
 * first shape — a migrated portrait was published at
 * `/api/v1/users/member-photos/headshots/<slug>/<file>` and served by nothing,
 * which is why it showed on the public members page and nowhere in the portal
 * (issue #28).
 *
 * What must not be lost with it: a replaced or removed photograph's address
 * stops resolving at once, because the row no longer names that file.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { validJpegBytes, validWebpBytes } from "./helpers/raster-images";
import { publicUserHeadshotPath, publicUserHeadshotUrl } from "../functions/_lib/services/user-headshot";
import { getUserDetail } from "../functions/_lib/services/user-management-detail";

/** Only what `storedRasterImageResponse` reads: a size and the bytes. */
class StoredObjects {
  private readonly objects = new Map<string, Uint8Array>();

  put(key: string, value: Uint8Array): void {
    this.objects.set(key, value);
  }

  async get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { size: stored.byteLength, arrayBuffer: async () => stored.buffer as ArrayBuffer };
  }
}

async function seedUserWithHeadshot(email: string, storageKey: string | null): Promise<{ userId: string }> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, active, headshot_r2_key, created_at, updated_at)
     VALUES (?, ?, ?, 'Portrait', 1, ?, datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, email, storageKey)
    .run();
  return { userId };
}

function fetchHeadshot(
  userId: string,
  file: string,
  uploads: StoredObjects,
  assets = new StoredObjects(),
  rendition: { query?: string; images?: FakeImages } = {},
): Promise<Response> {
  return callApi(
    {
      ...(env as any),
      SPEAKER_UPLOADS_BUCKET: uploads as unknown as R2Bucket,
      ASSETS_BUCKET: assets as unknown as R2Bucket,
      IMAGES: rendition.images,
    },
    `/api/v1/users/${encodeURIComponent(userId)}/headshots/${encodeURIComponent(file)}${rendition.query ?? ""}`,
  );
}

/** Records each transform and answers with `output()`; a throwing output stands in for a failed transform. */
class FakeImages {
  readonly transforms: Array<{ width?: number; height?: number; fit?: string; format: string }> = [];

  constructor(private readonly output: () => Uint8Array<ArrayBuffer> = () => validWebpBytes(96, 96)) {}

  input(stream: ReadableStream) {
    return {
      transform: (options: { width?: number; height?: number; fit?: string }) => ({
        output: async ({ format }: { format: string }) => {
          await new Response(stream).arrayBuffer();
          this.transforms.push({ ...options, format });
          const bytes = this.output();
          return { response: () => new Response(bytes) };
        },
      }),
    };
  }
}

describe("the public address of a stored headshot", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("names the owner from the row, whichever writer put the key there", () => {
    // The upload shape, unchanged.
    expect(publicUserHeadshotPath("user-1", "headshots/user-1/2026-01-01T00-00-00-000Z-abcd1234.jpg")).toBe(
      "/api/v1/users/user-1/headshots/2026-01-01T00-00-00-000Z-abcd1234.jpg",
    );
    // The migration's shape. The org slug in the key is not a user id and
    // never was; reading one out of it published an address for a user that
    // does not exist.
    expect(publicUserHeadshotPath("user-1", "member-photos/acme-corp/jane-doe.jpg")).toBe(
      "/api/v1/users/user-1/headshots/jane-doe.jpg",
    );
    // Nothing stored, nothing to publish; and a key with no prefix names no
    // owner, so it is not addressable either.
    expect(publicUserHeadshotPath("user-1", null)).toBeNull();
    expect(publicUserHeadshotPath("user-1", "loose-file.jpg")).toBeNull();
    // The absolute form carries the same path plus the version it was given.
    expect(
      publicUserHeadshotUrl("https://app.test", "user-1", "member-photos/acme-corp/jane-doe.jpg", "2026-01-01"),
    ).toBe("https://app.test/api/v1/users/user-1/headshots/jane-doe.jpg?v=2026-01-01");
  });

  it("serves a migrated portrait at the address the record publishes for it", async () => {
    const migratedKey = "member-photos/acme-corp/jane-doe.jpg";
    const { userId } = await seedUserWithHeadshot("migrated-portrait@example.test", migratedKey);
    const objects = new StoredObjects();
    objects.put(migratedKey, validJpegBytes());

    // The address the portal renders comes from the record, so the test
    // follows the one the product actually publishes rather than one it
    // spells out itself.
    const record = await getUserDetail(env.DB, userId);
    expect(record.headshotUrl).toBe(`/api/v1/users/${userId}/headshots/jane-doe.jpg`);

    const response = await fetchHeadshot(userId, "jane-doe.jpg", new StoredObjects(), objects);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("serves the dimensions of the imported Sven portrait without relaxing upload limits", async () => {
    const key = "member-photos/keyfactor/sven-rajala.jpg";
    const { userId } = await seedUserWithHeadshot("large-imported-portrait@example.test", key);
    const assets = new StoredObjects();
    assets.put(key, validJpegBytes(3024, 4032));
    expect((await fetchHeadshot(userId, "sven-rajala.jpg", new StoredObjects(), assets)).status).toBe(200);
    assets.put(key, validJpegBytes(8192, 4096));
    expect((await fetchHeadshot(userId, "sven-rajala.jpg", new StoredObjects(), assets)).status).toBe(404);
    const uploadKey = `headshots/${userId}/large.jpg`;
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(uploadKey, userId).run();
    const uploads = new StoredObjects();
    uploads.put(uploadKey, validJpegBytes(3024, 4032));
    expect((await fetchHeadshot(userId, "large.jpg", uploads)).status).toBe(404);
  });

  it("serves larger retained camera originals while bounding their bytes", async () => {
    const key = "member-photos/example/original.jpg";
    const { userId } = await seedUserWithHeadshot("camera-original@example.test", key);
    const assets = new StoredObjects();
    assets.put(key, validJpegBytes(5911, 3842));
    expect((await fetchHeadshot(userId, "original.jpg", new StoredObjects(), assets)).status).toBe(200);
    const original = new Uint8Array(5_455_770);
    original.set(validJpegBytes(2400, 3600));
    assets.put(key, original);
    expect((await fetchHeadshot(userId, "original.jpg", new StoredObjects(), assets)).status).toBe(200);
    assets.put(key, new Uint8Array(10 * 1024 * 1024 + 1));
    expect((await fetchHeadshot(userId, "original.jpg", new StoredObjects(), assets)).status).toBe(404);
  });

  it("serves an uploaded portrait at the address the record publishes for it", async () => {
    const uploadedKey = "headshots/placeholder/stored.jpg";
    const { userId } = await seedUserWithHeadshot("uploaded-portrait@example.test", uploadedKey);
    // The upload path writes the owner's own id into the key; the seed above
    // cannot know it before the insert, so it is corrected here.
    const ownedKey = `headshots/${userId}/stored.jpg`;
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(ownedKey, userId).run();
    const objects = new StoredObjects();
    objects.put(ownedKey, validJpegBytes());

    const record = await getUserDetail(env.DB, userId);
    expect(record.headshotUrl).toBe(`/api/v1/users/${userId}/headshots/stored.jpg`);
    expect((await fetchHeadshot(userId, "stored.jpg", objects)).status).toBe(200);
  });

  it("stops serving a file the row no longer names", async () => {
    const migratedKey = "member-photos/acme-corp/jane-doe.jpg";
    const { userId } = await seedUserWithHeadshot("replaced-portrait@example.test", migratedKey);
    const objects = new StoredObjects();
    objects.put(migratedKey, validJpegBytes());

    // The photograph is replaced. The old object may outlive the pointer while
    // its deletion is retried, so revocation cannot depend on the object being
    // gone — only on the row.
    const replacementKey = `headshots/${userId}/replacement.jpg`;
    const uploads = new StoredObjects();
    uploads.put(replacementKey, validJpegBytes());
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(replacementKey, userId).run();

    expect((await fetchHeadshot(userId, "jane-doe.jpg", uploads, objects)).status).toBe(404);
    expect((await fetchHeadshot(userId, "replacement.jpg", uploads, objects)).status).toBe(200);

    // And removal revokes the replacement's address too.
    await env.DB.prepare("UPDATE users SET headshot_r2_key = NULL WHERE id = ?").bind(userId).run();
    expect((await fetchHeadshot(userId, "replacement.jpg", uploads, objects)).status).toBe(404);
  });

  it("refuses one user's file under another user's address", async () => {
    const objects = new StoredObjects();
    const sharedFile = "portrait.jpg";
    const owner = await seedUserWithHeadshot("owner-portrait@example.test", `member-photos/acme-corp/${sharedFile}`);
    const stranger = await seedUserWithHeadshot("stranger-portrait@example.test", null);
    objects.put(`member-photos/acme-corp/${sharedFile}`, validJpegBytes());

    expect((await fetchHeadshot(owner.userId, sharedFile, new StoredObjects(), objects)).status).toBe(200);
    // The stranger's row names no file, so the same filename resolves to
    // nothing under their id.
    expect((await fetchHeadshot(stranger.userId, sharedFile, new StoredObjects(), objects)).status).toBe(404);
  });

  it("does not serve a migrated portrait from the uploads bucket", async () => {
    const key = "member-photos/acme-corp/wrong-bucket.jpg";
    const { userId } = await seedUserWithHeadshot("wrong-bucket@example.test", key);
    const uploads = new StoredObjects();
    uploads.put(key, validJpegBytes());
    expect((await fetchHeadshot(userId, "wrong-bucket.jpg", uploads)).status).toBe(404);
  });

  it("reports a missing stored object rather than an empty image", async () => {
    const migratedKey = "member-photos/acme-corp/jane-doe.jpg";
    const { userId } = await seedUserWithHeadshot("absent-object@example.test", migratedKey);

    // The row points at a key the bucket does not hold — the shape a failed or
    // half-finished migration upload leaves behind.
    expect((await fetchHeadshot(userId, "jane-doe.jpg", new StoredObjects())).status).toBe(404);
  });
});

describe("small renditions of the current headshot", () => {
  const BROWSER_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";

  beforeEach(async () => {
    await resetDb();
  });

  async function uploadedPortrait(email: string, file = "portrait.jpg") {
    const { userId } = await seedUserWithHeadshot(email, null);
    const key = `headshots/${userId}/${file}`;
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(key, userId).run();
    const uploads = new StoredObjects();
    uploads.put(key, validJpegBytes(1024, 1024));
    return { userId, key, uploads };
  }

  it("serves a square WebP of the current file under the full image's cache policy and reuses it", async () => {
    const { userId, uploads } = await uploadedPortrait("rendition@example.test");
    const images = new FakeImages();

    const response = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, { query: "?width=96", images });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe(BROWSER_CACHE_CONTROL);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(validWebpBytes(96, 96));
    expect(images.transforms).toEqual([{ width: 96, height: 96, fit: "cover", format: "image/webp" }]);

    // The same rendition is answered from this data center's cache, not transformed again.
    const repeat = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, { query: "?width=96", images });
    expect(repeat.status).toBe(200);
    expect(repeat.headers.get("cache-control")).toBe(BROWSER_CACHE_CONTROL);
    expect(new Uint8Array(await repeat.arrayBuffer())).toEqual(validWebpBytes(96, 96));
    expect(images.transforms).toHaveLength(1);

    // A different width is its own rendition; the version marker the portal appends is still accepted.
    const wider = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, {
      query: "?width=384&v=2026-01-01T00:00:00.000Z",
      images,
    });
    expect(wider.status).toBe(200);
    expect(images.transforms.map((transform) => transform.width)).toEqual([96, 384]);
  });

  it("falls back to the stored portrait, uncached, when no rendition can be made", async () => {
    const { userId, uploads } = await uploadedPortrait("rendition-fallback@example.test");

    const unbound = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, { query: "?width=192" });
    expect(unbound.status).toBe(200);
    expect(unbound.headers.get("content-type")).toBe("image/jpeg");
    expect(unbound.headers.get("cache-control")).toBe(BROWSER_CACHE_CONTROL);
    expect(new Uint8Array(await unbound.arrayBuffer())).toEqual(validJpegBytes(1024, 1024));

    const failing = new FakeImages(() => {
      throw new Error("transform unavailable");
    });
    const failed = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, {
      query: "?width=192",
      images: failing,
    });
    expect(failed.headers.get("content-type")).toBe("image/jpeg");

    const malformed = new FakeImages(() => validJpegBytes(192, 192));
    const refused = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, {
      query: "?width=192",
      images: malformed,
    });
    expect(refused.headers.get("content-type")).toBe("image/jpeg");

    // None of the fallbacks was cached as the rendition: a working transform still runs.
    const images = new FakeImages(() => validWebpBytes(192, 192));
    const recovered = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, { query: "?width=192", images });
    expect(recovered.headers.get("content-type")).toBe("image/webp");
    expect(images.transforms).toHaveLength(1);
  });

  it("revokes a cached rendition together with the file it came from", async () => {
    const { userId, uploads } = await uploadedPortrait("rendition-revoked@example.test");
    const images = new FakeImages();
    const first = await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, { query: "?width=96", images });
    expect(first.status).toBe(200);

    const replacementKey = `headshots/${userId}/replacement.jpg`;
    uploads.put(replacementKey, validJpegBytes(1024, 1024));
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(replacementKey, userId).run();
    expect(
      (await fetchHeadshot(userId, "portrait.jpg", uploads, undefined, { query: "?width=96", images })).status,
    ).toBe(404);

    await env.DB.prepare("UPDATE users SET headshot_r2_key = NULL WHERE id = ?").bind(userId).run();
    expect(
      (await fetchHeadshot(userId, "replacement.jpg", uploads, undefined, { query: "?width=96", images })).status,
    ).toBe(404);
  });

  it("renders a migrated portrait and refuses widths outside the closed set", async () => {
    const key = "member-photos/acme-corp/rendition.jpg";
    const { userId } = await seedUserWithHeadshot("rendition-migrated@example.test", key);
    const assets = new StoredObjects();
    assets.put(key, validJpegBytes(3024, 4032));
    const images = new FakeImages();

    const migrated = await fetchHeadshot(userId, "rendition.jpg", new StoredObjects(), assets, {
      query: "?width=96",
      images,
    });
    expect(migrated.status).toBe(200);
    expect(migrated.headers.get("content-type")).toBe("image/webp");

    for (const width of ["100", "1024", "0", "large"]) {
      const refused = await fetchHeadshot(userId, "rendition.jpg", new StoredObjects(), assets, {
        query: `?width=${width}`,
        images,
      });
      expect(refused.status).toBe(400);
    }
    expect(images.transforms).toHaveLength(1);
  });
});
