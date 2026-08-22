import { all, first, run } from "../db/queries";
import { logError } from "../logging";
import type { DatabaseLike, Env, StatementLike } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { createDurableJobLease } from "../jobs/lease";

export type StorageBucketName = "speaker_uploads" | "assets";
const SPEAKER_UPLOADS_BUCKET: StorageBucketName = "speaker_uploads";
const MAX_ATTEMPTS = 10;

interface StorageDeletionRow {
  id: string;
  bucket: string;
  object_key: string;
  attempts: number;
  processing_token: string | null;
}

export const STORAGE_DELETION_DUE_QUERY = `
  SELECT id, bucket, object_key, attempts, processing_token, next_attempt_at AS due_at, created_at
    FROM storage_deletion_outbox
   WHERE status IN ('queued', 'retrying') AND next_attempt_at <= ?
  UNION ALL
  SELECT id, bucket, object_key, attempts, processing_token, lease_expires_at AS due_at, created_at
    FROM storage_deletion_outbox
   WHERE status = 'deleting' AND lease_expires_at <= ?
  ORDER BY due_at, created_at, id
  LIMIT ?`;

export interface StorageDeletionResult {
  processed: number;
  failed: number;
}

export function prepareStorageDeletion(
  db: DatabaseLike,
  objectKey: string | null,
  createdAt = nowIso(),
  bucketName: StorageBucketName = SPEAKER_UPLOADS_BUCKET,
  notBefore = createdAt,
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
    .bind(uuid(), bucketName, objectKey, notBefore, createdAt, createdAt);
}

export function prepareStorageDeletionCancellation(
  db: DatabaseLike,
  objectKey: string,
  bucketName: StorageBucketName,
): StatementLike {
  return db
    .prepare(
      `DELETE FROM storage_deletion_outbox
       WHERE bucket = ? AND object_key = ?
         AND status IN ('queued', 'retrying')
         AND processing_token IS NULL`,
    )
    .bind(bucketName, objectKey);
}

function prepareStorageUploadCommitGuard(
  db: DatabaseLike,
  objectKey: string,
  bucketName: StorageBucketName,
): StatementLike {
  return db
    .prepare("INSERT INTO storage_upload_commit_guards (id, bucket, object_key) VALUES (?, ?, ?)")
    .bind(uuid(), bucketName, objectKey);
}

async function claimUploadCompensationCleanup(
  db: DatabaseLike,
  objectKey: string,
  bucketName: StorageBucketName,
): Promise<string | null> {
  const lease = createDurableJobLease();
  const claimed = await run(
    db,
    `UPDATE storage_deletion_outbox
     SET status = 'deleting', processing_token = ?, lease_expires_at = ?, updated_at = ?
     WHERE bucket = ? AND object_key = ?
       AND status IN ('queued', 'retrying') AND processing_token IS NULL`,
    [lease.token, lease.expiresAt, lease.claimedAt, bucketName, objectKey],
  );
  return claimed.changes === 1 ? lease.token : null;
}

async function releaseUploadCompensationCleanup(
  db: DatabaseLike,
  objectKey: string,
  bucketName: StorageBucketName,
  processingToken: string,
): Promise<void> {
  await run(
    db,
    `UPDATE storage_deletion_outbox
     SET status = 'queued', processing_token = NULL, lease_expires_at = NULL,
         next_attempt_at = ?, updated_at = ?
     WHERE bucket = ? AND object_key = ? AND status = 'deleting' AND processing_token = ?`,
    [nowIso(), nowIso(), bucketName, objectKey, processingToken],
  );
}

async function finalizeUploadCompensationCleanup(
  db: DatabaseLike,
  objectKey: string,
  bucketName: StorageBucketName,
  processingToken: string,
): Promise<void> {
  await run(
    db,
    `DELETE FROM storage_deletion_outbox
     WHERE bucket = ? AND object_key = ? AND status = 'deleting' AND processing_token = ?`,
    [bucketName, objectKey, processingToken],
  );
}

/**
 * Persists cleanup ownership before an R2 upload begins. The grace period
 * prevents the scheduled deleter from racing a healthy in-flight upload;
 * the committing D1 transaction cancels this intent with the new pointer.
 */
export async function registerStorageUploadCompensation(
  db: DatabaseLike,
  objectKey: string,
  bucketName: StorageBucketName,
  gracePeriodMs = 15 * 60_000,
): Promise<void> {
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO storage_deletion_outbox (
         id, bucket, object_key, status, attempts, next_attempt_at, last_error, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, 'queued', 0, ?, NULL, ?, ?, NULL)`,
    )
    .bind(uuid(), bucketName, objectKey, new Date(Date.now() + gracePeriodMs).toISOString(), createdAt, createdAt)
    .run();
}

/**
 * Coordinates an R2 upload with the D1 transaction that makes it durable.
 *
 * The object key must be unique to this upload attempt. Registration rejects
 * a collision with an active or retained deletion intent before R2 is touched.
 * A successful D1 batch finishes with a commit guard that atomically verifies
 * and cancels the cleanup intent. Callers with a guarded update must place
 * their one-change guard immediately after that update in
 * `prepareCommitStatements`; otherwise a zero-row CAS could incorrectly commit
 * dependent statements.
 *
 * When upload or commit fails, the caller must first acquire the still-present
 * cleanup intent before deleting R2. If the intent is absent, the D1 batch may
 * have committed even though its response was lost, so deleting the object
 * would create a durable dangling pointer. Cleanup errors never replace the
 * original upload/commit error.
 */
export async function withStorageUploadCompensation(input: {
  db: DatabaseLike;
  bucket: R2Bucket;
  bucketName: StorageBucketName;
  objectKey: string;
  upload: () => Promise<unknown>;
  prepareCommitStatements: () => StatementLike[];
  gracePeriodMs?: number;
}): Promise<void> {
  await registerStorageUploadCompensation(input.db, input.objectKey, input.bucketName, input.gracePeriodMs);

  try {
    await input.upload();
    await input.db.batch([
      ...input.prepareCommitStatements(),
      prepareStorageUploadCommitGuard(input.db, input.objectKey, input.bucketName),
    ]);
  } catch (error) {
    try {
      const processingToken = await claimUploadCompensationCleanup(input.db, input.objectKey, input.bucketName);
      if (processingToken) {
        try {
          await input.bucket.delete(input.objectKey);
          await finalizeUploadCompensationCleanup(input.db, input.objectKey, input.bucketName, processingToken);
        } catch {
          try {
            await releaseUploadCompensationCleanup(input.db, input.objectKey, input.bucketName, processingToken);
          } catch {
            // The claimed cleanup lease expires and becomes retryable.
          }
        }
      }
    } catch {
      // No cleanup ownership means the commit may have succeeded or another
      // worker owns deletion. In either case this caller must not delete R2.
    }
    throw error;
  }
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

async function markDeletionFailed(
  db: DatabaseLike,
  row: StorageDeletionRow,
  processingToken: string,
  error: unknown,
): Promise<void> {
  const attempts = row.attempts + 1;
  const retryDelaySeconds = Math.min(3600, 2 ** Math.min(attempts, 10) * 15);
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "retrying";
  const message = error instanceof Error ? error.message : "Unknown storage deletion error";
  await run(
    db,
    `UPDATE storage_deletion_outbox
     SET status = ?, attempts = ?, next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?), last_error = ?,
         processing_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'deleting' AND processing_token = ?`,
    [status, attempts, `+${retryDelaySeconds} seconds`, message.slice(0, 1000), nowIso(), row.id, processingToken],
  );
}

async function processStorageDeletionRow(
  db: DatabaseLike,
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET" | "ASSETS_BUCKET">,
  row: StorageDeletionRow,
): Promise<boolean> {
  const lease = createDurableJobLease();
  const claimed = await run(
    db,
    `UPDATE storage_deletion_outbox
     SET status = 'deleting', processing_token = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND next_attempt_at <= ?
       AND (status IN ('queued', 'retrying') OR (status = 'deleting' AND lease_expires_at <= ?))`,
    [lease.token, lease.expiresAt, lease.claimedAt, row.id, lease.claimedAt, lease.claimedAt],
  );
  if (claimed.changes !== 1) return false;

  try {
    const bucket = bucketForRow(env, row.bucket);
    if (!bucket) throw new Error(`Storage binding is unavailable for bucket ${row.bucket}`);
    await bucket.delete(row.object_key);
    await run(
      db,
      `UPDATE storage_deletion_outbox
       SET status = 'deleted', deleted_at = ?, last_error = NULL,
           processing_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'deleting' AND processing_token = ?`,
      [nowIso(), nowIso(), row.id, lease.token],
    );
    return true;
  } catch (error) {
    await markDeletionFailed(db, row, lease.token, error);
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
    `SELECT id, bucket, object_key, attempts, processing_token
     FROM storage_deletion_outbox
     WHERE bucket = ? AND object_key = ? AND next_attempt_at <= ?
       AND (status IN ('queued', 'retrying') OR (status = 'deleting' AND lease_expires_at <= ?))`,
    [bucketName, objectKey, nowIso(), nowIso()],
  );
  return row ? processStorageDeletionRow(db, env, row) : true;
}

export async function processPendingStorageDeletions(
  db: DatabaseLike,
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET" | "ASSETS_BUCKET">,
  limit: number,
): Promise<StorageDeletionResult> {
  if (limit <= 0) return { processed: 0, failed: 0 };
  const rows = await all<StorageDeletionRow>(db, STORAGE_DELETION_DUE_QUERY, [nowIso(), nowIso(), limit]);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    if (await processStorageDeletionRow(db, env, row)) processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}
