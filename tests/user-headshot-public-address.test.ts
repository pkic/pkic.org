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
import { validJpegBytes } from "./helpers/raster-images";
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
    `INSERT INTO users (id, email, normalized_email, first_name, role, active, headshot_r2_key, created_at, updated_at)
     VALUES (?, ?, ?, 'Portrait', 'user', 1, ?, datetime('now'), datetime('now'))`,
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
): Promise<Response> {
  return callApi(
    {
      ...(env as any),
      SPEAKER_UPLOADS_BUCKET: uploads as unknown as R2Bucket,
      ASSETS_BUCKET: assets as unknown as R2Bucket,
    },
    `/api/v1/users/${encodeURIComponent(userId)}/headshots/${encodeURIComponent(file)}`,
  );
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
