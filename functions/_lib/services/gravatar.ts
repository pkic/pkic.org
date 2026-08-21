import { first } from "../db/queries";
import type { Env } from "../types";
import { downloadGravatar } from "../utils/gravatar";
import { nowIso } from "../utils/time";
import { prepareBadgeRenderJobsForUser } from "./badge-render-job-statements";
import { prepareStorageDeletionCancellation, registerStorageUploadCompensation } from "./storage-deletion-outbox";

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
    const r2Key = `headshots/${userId}/${Date.now()}-gravatar.${extension}`;
    await registerStorageUploadCompensation(env.DB, r2Key, "speaker_uploads");
    await bucket.put(r2Key, image.buffer, { httpMetadata: { contentType: image.contentType } });

    const at = nowIso();
    const [updated] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ?
            WHERE id = ? AND headshot_r2_key IS NULL`,
      ).bind(r2Key, at, at, userId),
      prepareBadgeRenderJobsForUser(env.DB, userId, at),
      env.DB.prepare(
        `DELETE FROM storage_deletion_outbox
            WHERE bucket = 'speaker_uploads' AND object_key = ?
              AND EXISTS (SELECT 1 FROM users WHERE id = ? AND headshot_r2_key = ?)`,
      ).bind(r2Key, userId, r2Key),
    ]);
    if ((updated.meta?.changes ?? 0) === 1) return r2Key;

    try {
      await bucket.delete(r2Key);
      await prepareStorageDeletionCancellation(env.DB, r2Key, "speaker_uploads").run();
    } catch {
      // The pre-upload cleanup intent remains durable for scheduled retry.
    }
    return null;
  } catch {
    return null;
  }
}
