import { all, first, run } from "../db/queries";
import { logError } from "../logging";
import type { DatabaseLike, Env, StatementLike } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";

export type StorageBucketName = "speaker_uploads" | "assets";
const SPEAKER_UPLOADS_BUCKET: StorageBucketName = "speaker_uploads";
const MAX_ATTEMPTS = 10;

interface StorageDeletionRow {
  id: string;
  bucket: string;
  object_key: string;
  attempts: number;
}

export interface StorageDeletionResult {
  processed: number;
  failed: number;
}

export function prepareStorageDeletion(
  db: DatabaseLike,
  objectKey: string | null,
  createdAt = nowIso(),
  bucketName: StorageBucketName = SPEAKER_UPLOADS_BUCKET,
): StatementLike | null {
  if (!objectKey) return null;
  return db
    .prepare(
      `INSERT INTO storage_deletion_outbox (
         id, bucket, object_key, status, attempts, next_attempt_at, last_error, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, 'queued', 0, ?, NULL, ?, ?, NULL)
       ON CONFLICT(bucket, object_key) DO UPDATE SET
         status = CASE WHEN storage_deletion_outbox.deleted_at IS NULL THEN 'queued' ELSE storage_deletion_outbox.status END,
         next_attempt_at = CASE WHEN storage_deletion_outbox.deleted_at IS NULL THEN excluded.next_attempt_at ELSE storage_deletion_outbox.next_attempt_at END,
         updated_at = excluded.updated_at`,
    )
    .bind(uuid(), bucketName, objectKey, createdAt, createdAt, createdAt);
}

export async function enqueueStorageDeletion(
  db: DatabaseLike,
  objectKey: string,
  bucketName: StorageBucketName = SPEAKER_UPLOADS_BUCKET,
): Promise<void> {
  const statement = prepareStorageDeletion(db, objectKey, nowIso(), bucketName);
  if (statement) await statement.run();
}

function bucketForRow(
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET" | "ASSETS_BUCKET">,
  bucketName: string,
): R2Bucket | undefined {
  if (bucketName === SPEAKER_UPLOADS_BUCKET) return env.SPEAKER_UPLOADS_BUCKET;
  if (bucketName === "assets") return env.ASSETS_BUCKET;
  return undefined;
}

async function markDeletionFailed(db: DatabaseLike, row: StorageDeletionRow, error: unknown): Promise<void> {
  const attempts = row.attempts + 1;
  const retryDelaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10) * 15);
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "retrying";
  const message = error instanceof Error ? error.message : "Unknown storage deletion error";
  await run(
    db,
    `UPDATE storage_deletion_outbox
     SET status = ?, attempts = ?, next_attempt_at = datetime('now', ?), last_error = ?, updated_at = ?
     WHERE id = ? AND status = 'deleting'`,
    [status, attempts, `+${retryDelaySeconds} seconds`, message.slice(0, 1000), nowIso(), row.id],
  );
}

async function processStorageDeletionRow(
  db: DatabaseLike,
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET" | "ASSETS_BUCKET">,
  row: StorageDeletionRow,
): Promise<boolean> {
  const claimed = await run(
    db,
    `UPDATE storage_deletion_outbox
     SET status = 'deleting', updated_at = ?
     WHERE id = ? AND status IN ('queued', 'retrying') AND next_attempt_at <= ?`,
    [nowIso(), row.id, nowIso()],
  );
  if (claimed.changes !== 1) return false;

  try {
    const bucket = bucketForRow(env, row.bucket);
    if (!bucket) throw new Error(`Storage binding is unavailable for bucket ${row.bucket}`);
    await bucket.delete(row.object_key);
    await run(
      db,
      `UPDATE storage_deletion_outbox
       SET status = 'deleted', deleted_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ? AND status = 'deleting'`,
      [nowIso(), nowIso(), row.id],
    );
    return true;
  } catch (error) {
    await markDeletionFailed(db, row, error);
    logError("storage object deletion failed", { error, outboxId: row.id, bucket: row.bucket });
    return false;
  }
}

export async function processStorageDeletionForKey(
  db: DatabaseLike,
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET" | "ASSETS_BUCKET">,
  objectKey: string | null,
  bucketName: StorageBucketName = SPEAKER_UPLOADS_BUCKET,
): Promise<boolean> {
  if (!objectKey) return true;
  const row = await first<StorageDeletionRow>(
    db,
    `SELECT id, bucket, object_key, attempts
     FROM storage_deletion_outbox
     WHERE bucket = ? AND object_key = ? AND status IN ('queued', 'retrying') AND next_attempt_at <= ?`,
    [bucketName, objectKey, nowIso()],
  );
  return row ? processStorageDeletionRow(db, env, row) : true;
}

export async function processPendingStorageDeletions(
  db: DatabaseLike,
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET" | "ASSETS_BUCKET">,
  limit: number,
): Promise<StorageDeletionResult> {
  if (limit <= 0) return { processed: 0, failed: 0 };
  const rows = await all<StorageDeletionRow>(
    db,
    `SELECT id, bucket, object_key, attempts
     FROM storage_deletion_outbox
     WHERE status IN ('queued', 'retrying') AND next_attempt_at <= ?
     ORDER BY next_attempt_at, created_at
     LIMIT ?`,
    [nowIso(), limit],
  );
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    if (await processStorageDeletionRow(db, env, row)) processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}
