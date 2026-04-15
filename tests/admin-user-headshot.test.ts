import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { onRequest as adminUserHeadshotRequest } from "../functions/api/v1/admin/users/[userId]/headshot";
import app from "../functions/router";

const ADMIN_TOKEN = "admin-session-token";

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
}

class FailingUploadsBucket {
  async put(): Promise<void> {
    const error = new Error("Network connection lost.") as Error & { retryable?: boolean };
    error.retryable = true;
    throw error;
  }
}

async function setup(): Promise<{ adminId: string; targetUserId: string }> {
  await seedEventAndAdmin(env.DB);

  const adminId = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0].id;
  await createAdminSession(env.DB, adminId, ADMIN_TOKEN);

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
      createContext({ ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket }, request, { userId: targetUserId }),
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
