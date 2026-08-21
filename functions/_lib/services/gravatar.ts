import { first } from "../db/queries";
import type { Env } from "../types";
import { downloadGravatar } from "../utils/gravatar";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { prepareAuditLogAfterOneChange } from "./audit";
import { prepareBadgeRenderJobsForUser } from "./badge-render-job-statements";
import { withStorageUploadCompensation } from "./storage-deletion-outbox";

/**
 * Speculatively seeds a first headshot and its durable badge invalidation.
 * Admin replacement uses the audited user-headshot service instead.
 */
export async function fetchGravatar(
  userId: string,
  email: string,
  env: Pick<Env, "DB" | "SPEAKER_UPLOADS_BUCKET">,
): Promise<string | null> {
  const bucket = env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) return null;
  const row = await first<{ headshot_r2_key: string | null }>(
    env.DB,
    "SELECT headshot_r2_key FROM users WHERE id = ?",
    [userId],
  );
  if (!row || row.headshot_r2_key) return null;

  try {
    const image = await downloadGravatar(email);
    if (!image) return null;
    const extension = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : "jpg";
    const r2Key = `headshots/${userId}/${Date.now()}-${uuid()}-gravatar.${extension}`;
    const at = nowIso();
    await withStorageUploadCompensation({
      db: env.DB,
      bucket,
      bucketName: "speaker_uploads",
      objectKey: r2Key,
      upload: () => bucket.put(r2Key, image.buffer, { httpMetadata: { contentType: image.contentType } }),
      prepareCommitStatements: () => [
        env.DB.prepare(
          `UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ?
            WHERE id = ? AND headshot_r2_key IS NULL`,
        ).bind(r2Key, at, at, userId),
        prepareAuditLogAfterOneChange(
          env.DB,
          "system",
          null,
          "headshot_seeded_gravatar",
          "user",
          userId,
          { r2Key },
          at,
        ),
        prepareBadgeRenderJobsForUser(env.DB, userId, at),
      ],
    });
    return r2Key;
  } catch {
    return null;
  }
}
