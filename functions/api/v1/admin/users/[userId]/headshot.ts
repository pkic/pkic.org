/**
 * Admin headshot management endpoint.
 *
 * GET    /api/v1/admin/users/:userId/headshot        — serve the headshot image
 * PUT    /api/v1/admin/users/:userId/headshot        — upload / replace headshot
 * DELETE /api/v1/admin/users/:userId/headshot        — remove headshot
 *
 * All methods require admin authentication.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import { AppError } from "../../../../../_lib/errors";
import type { PagesContext } from "../../../../../_lib/types";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024; // 5 MB (raw input before admin crop UI; result will be a small JPEG)

interface HeadshotRow {
  id: string;
  headshot_r2_key: string | null;
}

// ── GET — serve the headshot image ──────────────────────────────────────────

async function onGet(context: PagesContext<{ userId: string }>): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const user = await first<HeadshotRow>(
    context.env.DB,
    "SELECT id, headshot_r2_key FROM users WHERE id = ?",
    [context.params.userId],
  );

  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  if (!user.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }

  const bucket = context.env.SPEAKER_UPLOADS_BUCKET;
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

async function onPut(context: PagesContext<{ userId: string }>): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const user = await first<HeadshotRow>(
    context.env.DB,
    "SELECT id, headshot_r2_key FROM users WHERE id = ?",
    [context.params.userId],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const bucket = context.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const contentType = context.request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json(
      { error: { code: "INVALID_CONTENT_TYPE", message: "Request must be multipart/form-data" } },
      400,
    );
  }

  const formData = await context.request.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return json({ error: { code: "MISSING_FILE", message: 'A "file" field is required.' } }, 400);
  }

  const blob = file as File;

  if (!ALLOWED_MIME_TYPES.has(blob.type)) {
    return json(
      { error: { code: "INVALID_FILE_TYPE", message: "Only JPEG, PNG, and WebP images are accepted." } },
      415,
    );
  }

  if (blob.size > MAX_HEADSHOT_BYTES) {
    return json(
      { error: { code: "FILE_TOO_LARGE", message: `Headshot must be under ${MAX_HEADSHOT_BYTES / (1024 * 1024)} MB.` } },
      413,
    );
  }

  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const r2Key = `headshots/${user.id}/${Date.now()}.${ext}`;

  await bucket.put(r2Key, await blob.arrayBuffer(), {
    httpMetadata: { contentType: blob.type },
  });

  // Delete old headshot from R2 if it exists (fire-and-forget)
  if (user.headshot_r2_key) {
    context.waitUntil(
      (bucket as unknown as { delete(key: string): Promise<void> }).delete(user.headshot_r2_key).catch(() => {}),
    );
  }

  const now = nowIso();
  await run(
    context.env.DB,
    "UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ? WHERE id = ?",
    [r2Key, now, now, user.id],
  );

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "headshot_uploaded",
    "user",
    user.id,
    { r2Key, uploadedBy: "admin" },
  );

  const origin = new URL(context.request.url).origin;
  context.waitUntil(invalidateAndRerender(user.id, context.env, origin));

  return json({ success: true, r2Key });
}

// ── DELETE — remove headshot ────────────────────────────────────────────────

async function onDelete(context: PagesContext<{ userId: string }>): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const user = await first<HeadshotRow>(
    context.env.DB,
    "SELECT id, headshot_r2_key FROM users WHERE id = ?",
    [context.params.userId],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  if (user.headshot_r2_key && context.env.SPEAKER_UPLOADS_BUCKET) {
    // We don't await deletion from R2 — it's best-effort
    context.waitUntil(
      context.env.SPEAKER_UPLOADS_BUCKET.put(user.headshot_r2_key, "").catch(() => {}),
    );
  }

  const now = nowIso();
  await run(
    context.env.DB,
    "UPDATE users SET headshot_r2_key = NULL, headshot_updated_at = NULL, updated_at = ? WHERE id = ?",
    [now, user.id],
  );

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "headshot_removed",
    "user",
    user.id,
    { previousKey: user.headshot_r2_key },
  );

  return json({ success: true });
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function onRequest(context: PagesContext<{ userId: string }>): Promise<Response> {
  switch (context.request.method) {
    case "GET":    return onGet(context);
    case "PUT":    return onPut(context);
    case "DELETE": return onDelete(context);
    default:
      return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
}
