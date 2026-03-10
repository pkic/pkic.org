/**
 * Attendee headshot management via registration manage token.
 *
 * PUT    /api/v1/registrations/manage/:token/headshot  — upload / replace headshot
 * DELETE /api/v1/registrations/manage/:token/headshot  — remove headshot
 *
 * Authentication is via the registration manage token (plain DB token or
 * admin-issued JWT).  No separate login session is required — the token in
 * the attendee's confirmation email is sufficient.
 *
 * The uploader must declare (via the `consent` form field) that:
 *  - The image is a photo of themselves
 *  - They own or have a royalty-free licence to the image
 *  - They accept full liability
 */

import { json } from "../../../../../_lib/http";
import { resolveManageToken } from "../../../../../_lib/services/manage-token";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import { AppError } from "../../../../../_lib/errors";
import type { PagesContext } from "../../../../../_lib/types";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HEADSHOT_BYTES = 2 * 1024 * 1024; // 2 MB — cropped JPEG from the client crop UI should be well under 500 KB

// ── PUT — upload / replace headshot ──────────────────────────────────────────

async function onPut(context: PagesContext<{ token: string }>): Promise<Response> {
  const resolved = await resolveManageToken(context.request, context.env, context.params.token);
  if (resolved instanceof Response) return resolved;
  const { registration } = resolved;

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
  const consentValue = formData.get("consent");
  if (consentValue !== "true") {
    return json(
      {
        error: {
          code: "CONSENT_REQUIRED",
          message:
            "You must confirm that the photo is of yourself, that you hold the necessary rights, and accept liability before uploading.",
        },
      },
      422,
    );
  }

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
      {
        error: {
          code: "FILE_TOO_LARGE",
          message: `Image must be smaller than ${MAX_HEADSHOT_BYTES / (1024 * 1024)} MB. The crop tool should produce a small JPEG — please try again or choose a smaller source image.`,
        },
      },
      413,
    );
  }

  // Look up the user
  const user = await first<{ id: string; headshot_r2_key: string | null }>(
    context.env.DB,
    "SELECT id, headshot_r2_key FROM users WHERE id = ?",
    [registration.user_id],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const filename = `${nowIso().replace(/[:.]/g, "-")}-${uuid().slice(0, 8)}.${ext}`;
  const r2Key = `headshots/${user.id}/${filename}`;

  // Delete old headshot from R2 if present
  if (user.headshot_r2_key) {
    try {
      await (bucket as unknown as { delete(key: string): Promise<void> }).delete(user.headshot_r2_key);
    } catch {
      // Non-fatal — proceed even if old file deletion fails
    }
  }

  const arrayBuffer = await blob.arrayBuffer();
  await bucket.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: blob.type },
    customMetadata: { source: "attendee_self_upload" },
  });

  await run(
    context.env.DB,
    "UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ? WHERE id = ?",
    [r2Key, nowIso(), nowIso(), user.id],
  );

  await writeAuditLog(
    context.env.DB,
    "user",
    user.id,
    "headshot_uploaded_by_attendee",
    "user",
    user.id,
    { r2Key, registrationId: registration.id },
  );

  const origin = new URL(context.request.url).origin;
  context.waitUntil(invalidateAndRerender(user.id, context.env, origin));

  const parts = r2Key.split("/");
  const pubFilename = parts.slice(2).join("/");
  const headshotUrl = `${origin}/api/v1/headshots/${user.id}/${pubFilename}`;

  return json({ success: true, headshotUrl });
}

// ── DELETE — remove headshot ──────────────────────────────────────────────────

async function onDelete(context: PagesContext<{ token: string }>): Promise<Response> {
  const resolved = await resolveManageToken(context.request, context.env, context.params.token);
  if (resolved instanceof Response) return resolved;
  const { registration } = resolved;

  const user = await first<{ id: string; headshot_r2_key: string | null }>(
    context.env.DB,
    "SELECT id, headshot_r2_key FROM users WHERE id = ?",
    [registration.user_id],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const bucket = context.env.SPEAKER_UPLOADS_BUCKET;
  if (bucket && user.headshot_r2_key) {
    try {
      await (bucket as unknown as { delete(key: string): Promise<void> }).delete(user.headshot_r2_key);
    } catch {
      // Non-fatal
    }
  }

  await run(
    context.env.DB,
    "UPDATE users SET headshot_r2_key = NULL, headshot_updated_at = NULL, updated_at = ? WHERE id = ?",
    [nowIso(), user.id],
  );

  await writeAuditLog(
    context.env.DB,
    "user",
    user.id,
    "headshot_deleted_by_attendee",
    "user",
    user.id,
    { registrationId: registration.id },
  );

  const origin = new URL(context.request.url).origin;
  context.waitUntil(invalidateAndRerender(user.id, context.env, origin));

  return json({ success: true });
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  if (context.request.method === "PUT") return onPut(context);
  if (context.request.method === "DELETE") return onDelete(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
