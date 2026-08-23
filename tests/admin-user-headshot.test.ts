import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import app from "../functions/router";
import { replaceUserHeadshot } from "../functions/_lib/services/user-headshot";
import { processPendingStorageDeletions } from "../functions/_lib/services/storage-deletion-outbox";
import { createReferralCode } from "../functions/_lib/services/referrals";

let ADMIN_TOKEN = "admin-session-token";

interface StoredObject {
  body: ArrayBuffer;
  contentType: string;
}

class FakeUploadsBucket {
  private readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: Record<string, unknown>,
  ): Promise<void> {
    let body: ArrayBuffer;

    if (typeof value === "string") {
      body = new TextEncoder().encode(value).buffer;
    } else if (value instanceof ArrayBuffer) {
      body = value;
    } else {
      body = await new Response(value).arrayBuffer();
    }

    const contentType =
      (options?.httpMetadata as { contentType?: string } | undefined)?.contentType ?? "application/octet-stream";

    this.objects.set(key, { body, contentType });
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      async arrayBuffer() {
        return stored.body;
      },
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  stored(key: string): StoredObject | undefined {
    return this.objects.get(key);
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

class FailingDeleteUploadsBucket extends FakeUploadsBucket {
  failuresRemaining = 1;

  override async delete(key: string): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("Temporary R2 deletion failure");
    }
    await super.delete(key);
  }
}

class FailingUploadsBucket {
  async put(): Promise<void> {
    const error = new Error("Network connection lost.") as Error & { retryable?: boolean };
    error.retryable = true;
    throw error;
  }
}

async function mountedAdminHeadshotRoute(context: {
  req: { raw: Request };
  env: unknown;
  executionCtx?: { waitUntil(promise: Promise<unknown>): void };
}): Promise<Response> {
  const response = await app.fetch(
    context.req.raw,
    context.env as any,
    (context.executionCtx ?? { passThroughOnException: () => {}, waitUntil: () => {} }) as any,
  );
  if (response.ok) return response;
  const payload = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { error?: Record<string, unknown> };
  const error = Object.assign(
    new Error(String(payload.error?.message ?? "Request failed")),
    { status: response.status },
    payload.error ?? {},
  );
  throw error;
}

const adminUserHeadshotRequest = mountedAdminHeadshotRoute;

async function setup(): Promise<{ adminId: string; targetUserId: string }> {
  await seedEventAndAdmin(env.DB);

  const adminId = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0].id;
  ADMIN_TOKEN = await createAdminSession(env.DB, adminId, ADMIN_TOKEN);

  const targetUserId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'Upload', 'Target', 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(targetUserId, "upload-target@example.test", "upload-target@example.test")
    .run();

  return { adminId, targetUserId };
}

describe("admin user headshot upload", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("imports Gravatar through the atomic headshot service and durably invalidates owned badges", async () => {
    const { targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();
    const oldKey = `headshots/${targetUserId}/old.jpg`;
    await bucket.put(oldKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer);
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(oldKey, targetUserId).run();
    const [{ id: eventId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM events LIMIT 1");
    const registrationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
    )
      .bind(registrationId, eventId, targetUserId, crypto.randomUUID())
      .run();
    const referralCode = await createReferralCode(env.DB, {
      eventId,
      ownerType: "registration",
      ownerId: registrationId,
      length: 7,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "content-type": "image/jpeg" } }),
        ),
    );
    const background: Promise<unknown>[] = [];

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/admin/users/${targetUserId}/gravatar`, {
        method: "POST",
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
      { ...(env as any), IMAGES: undefined, SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException() {},
        waitUntil(promise: Promise<unknown>) {
          background.push(promise);
        },
      } as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { r2Key: string };
    expect(body.r2Key).not.toBe(oldKey);
    expect(await queryAll(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", targetUserId)).toEqual([
      { headshot_r2_key: body.r2Key },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? AND action = 'headshot_imported_gravatar'",
        targetUserId,
      ),
    ).toEqual([{ action: "headshot_imported_gravatar" }]);
    expect(
      await queryAll(env.DB, "SELECT id, status FROM badge_render_jobs WHERE referral_code = ?", referralCode),
    ).toEqual([{ id: `badge:${referralCode}`, status: "queued" }]);
    expect(
      await queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox WHERE object_key = ?", oldKey),
    ).toEqual([{ object_key: oldKey }]);
    await Promise.all(background);
  });

  it("accepts direct image upload and stores key in DB", async () => {
    const { targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();

    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "image/jpeg",
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    const response = await adminUserHeadshotRequest(
      createContext({ ...(env as any), IMAGES: undefined, SPEAKER_UPLOADS_BUCKET: bucket }, request, {
        userId: targetUserId,
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean; r2Key: string };
    expect(payload.success).toBe(true);
    expect(payload.r2Key.startsWith(`headshots/${targetUserId}/`)).toBe(true);

    const row = (
      await queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
        targetUserId,
      ])
    )[0];
    expect(row.headshot_r2_key).toBe(payload.r2Key);
  });

  it("preserves direct image uploads through the mounted OpenAPI route", async () => {
    const { targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "image/jpeg",
        },
        body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }),
      { ...(env as any), IMAGES: undefined, SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException() {}, waitUntil() {} } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean; r2Key: string };
    expect(payload).toMatchObject({ success: true });
    expect(payload.r2Key).toMatch(new RegExp(`^headshots/${targetUserId}/`));
    await expect(
      queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
        targetUserId,
      ]),
    ).resolves.toEqual([{ headshot_r2_key: payload.r2Key }]);
  });

  it("accepts multipart upload with file field", async () => {
    const { targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "headshot.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", file);

    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: formData,
    });

    const context = createContext({ ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket }, request, {
      userId: targetUserId,
    });
    context.req!.parseBody = async () => ({ file });

    const response = await adminUserHeadshotRequest(context);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean; r2Key: string };
    expect(payload.success).toBe(true);
    expect(payload.r2Key.startsWith(`headshots/${targetUserId}/`)).toBe(true);
  });

  it("preserves validated PNG type when Cloudflare Images is unavailable", async () => {
    const { targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "PUT",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "image/png" },
      body: pngHeader,
    });

    const response = await adminUserHeadshotRequest(
      createContext({ ...(env as any), IMAGES: undefined, SPEAKER_UPLOADS_BUCKET: bucket }, request, {
        userId: targetUserId,
      }),
    );
    const payload = (await response.json()) as { r2Key: string };
    expect(payload.r2Key).toMatch(/\.png$/);
    expect(bucket.stored(payload.r2Key)?.contentType).toBe("image/png");
  });

  it("rejects a declared image MIME type when the bytes do not match", async () => {
    const { targetUserId } = await setup();
    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "PUT",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "image/jpeg" },
      body: new TextEncoder().encode("<script>alert(1)</script>"),
    });

    await expect(
      adminUserHeadshotRequest(
        createContext({ ...(env as any), SPEAKER_UPLOADS_BUCKET: new FakeUploadsBucket() }, request, {
          userId: targetUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_FILE_TYPE", status: 415 });
  });

  it("clears the D1 reference and deletes the prior R2 object", async () => {
    const { targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();
    const oldKey = `headshots/${targetUserId}/old.jpg`;
    await bucket.put(oldKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(oldKey, targetUserId).run();
    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    const context = createContext({ ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket }, request, {
      userId: targetUserId,
    });
    const pending: Promise<unknown>[] = [];
    context.executionCtx.waitUntil = (promise: Promise<unknown>) => {
      pending.push(promise);
    };
    const response = await adminUserHeadshotRequest(context);
    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(await bucket.get(oldKey)).toBeNull();
    expect(
      (
        await queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
          targetUserId,
        ])
      )[0].headshot_r2_key,
    ).toBeNull();
  });

  it("maps bucket upload transport failures to UPLOAD_FAILED", async () => {
    const { targetUserId } = await setup();
    const bucket = new FailingUploadsBucket();

    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "image/jpeg",
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    await expect(
      adminUserHeadshotRequest(
        createContext({ ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket }, request, { userId: targetUserId }),
      ),
    ).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
      status: 503,
    });
  });

  it("allows only one concurrent replacement and cleans up the losing object", async () => {
    const { adminId, targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();
    const oldKey = `headshots/${targetUserId}/old.jpg`;
    await bucket.put(oldKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer);
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(oldKey, targetUserId).run();

    const replace = () =>
      replaceUserHeadshot({
        db: env.DB,
        bucket: bucket as unknown as R2Bucket,
        userId: targetUserId,
        previousKey: oldKey,
        image: { buffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, contentType: "image/jpeg" },
        audit: { actorType: "admin", actorId: adminId, action: "headshot_uploaded" },
      });
    const results = await Promise.allSettled([replace(), replace()]);
    const winner = results.find((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled");
    const loser = results.find((result): result is PromiseRejectedResult => result.status === "rejected");

    expect(winner).toBeDefined();
    expect(loser?.reason).toMatchObject({ status: 409, code: "HEADSHOT_CHANGED" });
    expect(bucket.keys().filter((key) => key !== oldKey)).toEqual([winner!.value]);
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? AND action = 'headshot_uploaded'",
        [targetUserId],
      ),
    ).toHaveLength(1);
    expect(
      await queryAll<{ object_key: string }>(
        env.DB,
        "SELECT object_key FROM storage_deletion_outbox WHERE bucket = 'speaker_uploads' ORDER BY object_key",
      ),
    ).toEqual([{ object_key: oldKey }]);
  });

  it("removes a new headshot when its audited pointer commit fails", async () => {
    const { adminId, targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();
    await env.DB.prepare(
      `CREATE TRIGGER fail_headshot_upload_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'headshot_uploaded'
       BEGIN
         SELECT RAISE(ABORT, 'forced headshot audit failure');
       END`,
    ).run();

    try {
      await expect(
        replaceUserHeadshot({
          db: env.DB,
          bucket: bucket as unknown as R2Bucket,
          userId: targetUserId,
          previousKey: null,
          image: { buffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, contentType: "image/jpeg" },
          audit: { actorType: "admin", actorId: adminId, action: "headshot_uploaded" },
        }),
      ).rejects.toThrow("forced headshot audit failure");
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_headshot_upload_audit").run();
    }

    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
        targetUserId,
      ]),
    ).toEqual([{ headshot_r2_key: null }]);
    expect(
      await queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox WHERE bucket = 'speaker_uploads'"),
    ).toEqual([]);
  });

  it("retains a failed headshot compensation for durable retry", async () => {
    const { adminId, targetUserId } = await setup();
    const bucket = new FailingDeleteUploadsBucket();
    await env.DB.prepare(
      `CREATE TRIGGER fail_headshot_upload_audit_retry
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'headshot_uploaded'
       BEGIN
         SELECT RAISE(ABORT, 'forced headshot audit failure');
       END`,
    ).run();

    try {
      await expect(
        replaceUserHeadshot({
          db: env.DB,
          bucket: bucket as unknown as R2Bucket,
          userId: targetUserId,
          previousKey: null,
          image: { buffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, contentType: "image/jpeg" },
          audit: { actorType: "admin", actorId: adminId, action: "headshot_uploaded" },
        }),
      ).rejects.toThrow("forced headshot audit failure");
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_headshot_upload_audit_retry").run();
    }

    const [storedKey] = bucket.keys();
    expect(storedKey).toMatch(new RegExp(`^headshots/${targetUserId}/`));
    expect(
      await queryAll<{ object_key: string; status: string }>(
        env.DB,
        "SELECT object_key, status FROM storage_deletion_outbox WHERE bucket = 'speaker_uploads'",
      ),
    ).toEqual([{ object_key: storedKey, status: "queued" }]);
    expect(
      await queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
        targetUserId,
      ]),
    ).toEqual([{ headshot_r2_key: null }]);

    await env.DB.prepare("UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now') WHERE object_key = ?")
      .bind(storedKey)
      .run();
    await expect(
      processPendingStorageDeletions(env.DB, { SPEAKER_UPLOADS_BUCKET: bucket as unknown as R2Bucket }, 10),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM storage_deletion_outbox WHERE object_key = ?", [
        storedKey,
      ]),
    ).toEqual([{ status: "deleted" }]);
  });

  it("revokes the public URL immediately and retries a failed R2 deletion", async () => {
    const { targetUserId } = await setup();
    const bucket = new FailingDeleteUploadsBucket();
    const oldFile = "old.jpg";
    const oldKey = `headshots/${targetUserId}/${oldFile}`;
    await bucket.put(oldKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer);
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(oldKey, targetUserId).run();

    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const context = createContext({ ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket }, request, {
      userId: targetUserId,
    });
    const pending: Promise<unknown>[] = [];
    context.executionCtx.waitUntil = (promise: Promise<unknown>) => pending.push(promise);
    expect((await adminUserHeadshotRequest(context)).status).toBe(200);
    await Promise.all(pending);

    expect(await bucket.get(oldKey)).not.toBeNull();
    const publicResponse = await app.fetch(
      new Request(`https://app.test/api/v1/headshots/${targetUserId}/${oldFile}`),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(publicResponse.status).toBe(404);
    expect(
      await queryAll<{ status: string; attempts: number }>(
        env.DB,
        "SELECT status, attempts FROM storage_deletion_outbox WHERE object_key = ?",
        [oldKey],
      ),
    ).toEqual([{ status: "retrying", attempts: 1 }]);

    await env.DB.prepare("UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now') WHERE object_key = ?")
      .bind(oldKey)
      .run();
    await processPendingStorageDeletions(env.DB, { SPEAKER_UPLOADS_BUCKET: bucket as unknown as R2Bucket }, 10);
    expect(await bucket.get(oldKey)).toBeNull();
    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM storage_deletion_outbox WHERE object_key = ?", [
        oldKey,
      ]),
    ).toEqual([{ status: "deleted" }]);
  });

  it("works through full router pipeline via app.fetch", async () => {
    const { targetUserId } = await setup();
    const bucket = new FakeUploadsBucket();

    const request = new Request(`https://app.test/api/v1/admin/users/${targetUserId}/headshot`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "image/jpeg",
      },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    const response = await app.fetch(request, { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket }, {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { success: boolean; r2Key: string };
    expect(payload.success).toBe(true);
    expect(payload.r2Key.startsWith(`headshots/${targetUserId}/`)).toBe(true);
  });
});
