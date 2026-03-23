/**
 * Headshot upload endpoint (token-authenticated).
 *
 * PUT /api/v1/proposals/speaker/[token]/headshot
 *   Content-Type: multipart/form-data
 *   Field: "file" — JPEG / PNG / WebP image
 *
 * The image is stored in the SPEAKER_UPLOADS_BUCKET R2 bucket under:
 *   headshots/{userId}/{timestamp}-{originalFilename}
 *
 * The user's headshot_r2_key and headshot_updated_at are updated in the DB.
 * Speakers can re-upload at any time to replace their headshot.
 */
import { json, markSensitive } from "../../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import {
  getSpeakerByManageToken,
  updateSpeakerProfile,
} from "../../../../../_lib/services/proposals";
import { AppError } from "../../../../../_lib/errors";
import type { PagesContext } from "../../../../../_lib/types";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_HEADSHOT_BYTES = 20 * 1024 * 1024; // 20 MB

async function onRequestGet(context: PagesContext<{ token: string }>): Promise<Response> {
  const { user } = await getSpeakerByManageToken(context.env.DB, context.params.token);

  if (!user.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }

  const bucket = context.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");
  }

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

export async function onRequestPut(context: PagesContext<{ token: string }>): Promise<Response> {
  const { speaker, user } = await getSpeakerByManageToken(context.env.DB, context.params.token);

  if (speaker.status === "declined") {
    return json(
      { error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } },
      403,
    );
  }

  const bucket = context.env.SPEAKER_UPLOADS_BUCKET;

  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");
  }

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
      {
        error: {
          code: "INVALID_FILE_TYPE",
          message: "Only JPEG, PNG, and WebP images are accepted.",
        },
      },
      415,
    );
  }

  if (blob.size > MAX_HEADSHOT_BYTES) {
    return json(
      { error: { code: "FILE_TOO_LARGE", message: "Headshot must be under 20 MB." } },
      413,
    );
  }

  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const r2Key = `headshots/${user.id}/${Date.now()}.${ext}`;

  await bucket.put(r2Key, await blob.arrayBuffer(), {
    httpMetadata: { contentType: blob.type },
  });

  await updateSpeakerProfile(context.env.DB, user.id, { headshotR2Key: r2Key });

  const origin = resolveAppBaseUrl(context.env);
  context.waitUntil(invalidateAndRerender(user.id, context.env, origin));

  return json({
    success: true,
    r2Key,
    headshotUrl: `${new URL(context.request.url).origin}/api/v1/proposals/speaker/${encodeURIComponent(context.params.token)}/headshot?v=${encodeURIComponent(String(Date.now()))}`,
  });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PUT") return onRequestPut(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
