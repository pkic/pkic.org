/**
 * Admin headshot management endpoint.
 *
 * GET    /api/v1/admin/users/:userId/headshot        — serve the headshot image
 * PUT    /api/v1/admin/users/:userId/headshot        — upload / replace headshot
 * DELETE /api/v1/admin/users/:userId/headshot        — remove headshot
 *
 * All methods require admin authentication.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import { AppError } from "../../../../../_lib/errors";
import { readUploadedImage, resizeHeadshot } from "../../../../../_lib/utils/headshot-upload";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024; // 5 MB (raw input before admin crop UI; result will be a small JPEG)

interface HeadshotRow {
  id: string;
  headshot_r2_key: string | null;
}

// ── GET — serve the headshot image ──────────────────────────────────────────

async function onGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await first<HeadshotRow>(requestDb(c), "SELECT id, headshot_r2_key FROM users WHERE id = ?", [
    c.req.param("userId"),
  ]);

  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  if (!user.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const obj = await bucket.get(user.headshot_r2_key);
  if (!obj) {
    return json({ error: { code: "NOT_FOUND", message: "Headshot file missing from storage" } }, 404);
  }

  const ext = user.headshot_r2_key.split(".").pop()?.toLowerCase() ?? "";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

// ── PUT — upload / replace headshot ─────────────────────────────────────────

async function onPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await first<HeadshotRow>(requestDb(c), "SELECT id, headshot_r2_key FROM users WHERE id = ?", [
    c.req.param("userId"),
  ]);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const { buffer, contentType } = await readUploadedImage(c.req.raw);

  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    return json(
      { error: { code: "INVALID_FILE_TYPE", message: "Only JPEG, PNG, and WebP images are accepted." } },
      415,
    );
  }

  if (buffer.byteLength > MAX_HEADSHOT_BYTES) {
    return json(
      {
        error: { code: "FILE_TOO_LARGE", message: `Headshot must be under ${MAX_HEADSHOT_BYTES / (1024 * 1024)} MB.` },
      },
      413,
    );
  }

  const resized = await resizeHeadshot(buffer, c.env.IMAGES);
  const ext = resized.contentType === "image/png" ? "png" : resized.contentType === "image/webp" ? "webp" : "jpg";
  const r2Key = `headshots/${user.id}/${Date.now()}.${ext}`;

  try {
    await bucket.put(r2Key, resized.buffer, {
      httpMetadata: { contentType: resized.contentType },
    });
  } catch {
    throw new AppError(503, "UPLOAD_FAILED", "Failed to upload headshot");
  }

  // Delete old headshot from R2 if it exists (fire-and-forget)
  if (user.headshot_r2_key) {
    c.executionCtx.waitUntil(
      (bucket as unknown as { delete(key: string): Promise<void> }).delete(user.headshot_r2_key).catch(() => {}),
    );
  }

  const now = nowIso();
  await run(
    requestDb(c),
    "UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ? WHERE id = ?",
    [r2Key, now, now, user.id],
  );

  await writeAuditLog(requestDb(c), "admin", admin.id, "headshot_uploaded", "user", user.id, {
    r2Key,
    uploadedBy: "admin",
  });

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  c.executionCtx.waitUntil(invalidateAndRerender(user.id, c.env, origin));

  return json({ success: true, r2Key });
}

// ── DELETE — remove headshot ────────────────────────────────────────────────

async function onDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const user = await first<HeadshotRow>(requestDb(c), "SELECT id, headshot_r2_key FROM users WHERE id = ?", [
    c.req.param("userId"),
  ]);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  if (user.headshot_r2_key && c.env.SPEAKER_UPLOADS_BUCKET) {
    // We don't await deletion from R2 — it's best-effort
    c.executionCtx.waitUntil(c.env.SPEAKER_UPLOADS_BUCKET.put(user.headshot_r2_key, "").catch(() => {}));
  }

  const now = nowIso();
  await run(
    requestDb(c),
    "UPDATE users SET headshot_r2_key = NULL, headshot_updated_at = NULL, updated_at = ? WHERE id = ?",
    [now, user.id],
  );

  await writeAuditLog(requestDb(c), "admin", admin.id, "headshot_removed", "user", user.id, {
    previousKey: user.headshot_r2_key,
  });

  return json({ success: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function onRequest(c: AdminContext): Promise<Response> {
  switch (c.req.raw.method) {
    case "GET":
      return onGet(c);
    case "PUT":
      return onPut(c);
    case "DELETE":
      return onDelete(c);
    default:
      return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
}

export class AdminUsersUserIdHeadshotGet extends OpenAPIRoute {
  schema = {};

  async handle(c: AdminContext) {
    return onGet(c);
  }
}

export class AdminUsersUserIdHeadshotPut extends OpenAPIRoute {
  schema = {};

  async handle(c: AdminContext) {
    return onPut(c);
  }
}

export class AdminUsersUserIdHeadshotDelete extends OpenAPIRoute {
  schema = {};

  async handle(c: AdminContext) {
    return onDelete(c);
  }
}
