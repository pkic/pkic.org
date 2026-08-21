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
import { json } from "../../../../../_lib/http";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import { getSpeakerByManageToken } from "../../../../../_lib/services/proposals";
import { AppError } from "../../../../../_lib/errors";
import { requireInternalSecret } from "../../../../../_lib/request";
import { SPEAKER_HEADSHOT_MAX_BYTES } from "../../../../../../assets/shared/schemas/images";
import { readValidatedUploadedImage } from "../../../../../_lib/utils/image-upload";
import {
  removePreviousHeadshot,
  removeUserHeadshot,
  replaceUserHeadshot,
} from "../../../../../_lib/services/user-headshot";
import { storedImageResponse } from "../../../../../_lib/services/image-response";

export async function onRequestGet(c: any): Promise<Response> {
  const { user } = await getSpeakerByManageToken(c.env.DB, c.req.param("token"), requireInternalSecret(c.env));

  if (!user.headshot_r2_key) {
    return json({ error: { code: "NOT_FOUND", message: "No headshot on file" } }, 404);
  }

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");
  }

  return storedImageResponse(bucket, user.headshot_r2_key, {
    notFoundCode: "NOT_FOUND",
    notFoundMessage: "Headshot file missing from storage",
    cacheControl: "private, max-age=3600",
  });
}

export async function onRequestPut(c: any): Promise<Response> {
  const { speaker, user } = await getSpeakerByManageToken(c.env.DB, c.req.param("token"), requireInternalSecret(c.env));

  if (speaker.status === "declined") {
    return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
  }

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;

  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");
  }

  const contentType = c.req.raw.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: { code: "INVALID_CONTENT_TYPE", message: "Request must be multipart/form-data" } }, 400);
  }

  const image = await readValidatedUploadedImage(c.req.raw, "Headshot", SPEAKER_HEADSHOT_MAX_BYTES);
  const r2Key = await replaceUserHeadshot({
    db: c.env.DB,
    bucket,
    userId: user.id,
    previousKey: user.headshot_r2_key,
    image,
    source: "speaker_self_upload",
    audit: { actorType: "user", actorId: user.id, action: "headshot_uploaded_by_speaker" },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(c.env.DB, c.env, user.headshot_r2_key));

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  await invalidateAndRerender(user.id, c.env, origin);

  return json({
    success: true,
    r2Key,
    headshotUrl: `${origin}/api/v1/proposals/speaker/${encodeURIComponent(c.req.param("token"))}/headshot?v=${encodeURIComponent(String(Date.now()))}`,
  });
}

export async function onRequestDelete(c: any): Promise<Response> {
  const { user } = await getSpeakerByManageToken(c.env.DB, c.req.param("token"), requireInternalSecret(c.env));

  await removeUserHeadshot({
    db: c.env.DB,
    userId: user.id,
    previousKey: user.headshot_r2_key,
    audit: {
      actorType: "user",
      actorId: user.id,
      action: "headshot_deleted_by_speaker",
      details: { speakerUserId: user.id },
    },
  });
  c.executionCtx.waitUntil(removePreviousHeadshot(c.env.DB, c.env, user.headshot_r2_key));

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  await invalidateAndRerender(user.id, c.env, origin);

  return json({ success: true });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  if (c.req.raw.method === "DELETE") return onRequestDelete(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
