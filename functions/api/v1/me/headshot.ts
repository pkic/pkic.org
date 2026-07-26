/**
 * POST /api/v1/me/headshot — upload my headshot (PRD §4.10). Mirrors
 * admin/users/[userId]/headshot.ts's PUT handler (same upload/resize
 * pipeline, R2 bucket, and old-key cleanup) but scoped to the caller's own
 * identity — no target user id, member-session gated instead of admin.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { run } from "../../../_lib/db/queries";
import { nowIso } from "../../../_lib/utils/time";
import { AppError } from "../../../_lib/errors";
import {
  ALLOWED_MIME_TYPES,
  MAX_HEADSHOT_BYTES,
  readUploadedImage,
  resizeHeadshot,
} from "../../../_lib/utils/headshot-upload";
import { myHeadshotUploadRouteSchema } from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  }

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
  const r2Key = `headshots/${member.userId}/${Date.now()}.${ext}`;

  await bucket.put(r2Key, resized.buffer, { httpMetadata: { contentType: resized.contentType } });

  const now = nowIso();
  await run(db, "UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ? WHERE id = ?", [
    r2Key,
    now,
    now,
    member.userId,
  ]);

  return json({ success: true, r2Key });
}

export class MeHeadshotPost extends OpenAPIRoute {
  schema = myHeadshotUploadRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
