import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  processPendingStorageDeletions,
  withStorageUploadCompensation,
} from "../functions/_lib/services/storage-deletion-outbox";
import { prepareAuditLogAfterOneChange } from "../functions/_lib/services/audit";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";

class FakeBucket {
  private readonly objects = new Map<string, string>();
  deleteFailuresRemaining = 0;

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async delete(key: string): Promise<void> {
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error("simulated R2 delete failure");
    }
    this.objects.delete(key);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }
}

function successfulCommitStatement(action: string) {
  return env.DB.prepare(
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, 'system', NULL, ?, 'storage_test', NULL, NULL, datetime('now'))`,
  ).bind(crypto.randomUUID(), action);
}

function failingCommitStatement() {
  return env.DB.prepare(
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, 'system', NULL, NULL, 'storage_test', NULL, NULL, datetime('now'))`,
  ).bind(crypto.randomUUID());
}

describe("storage upload compensation", () => {
  beforeEach(resetDb);

  it("cancels the durable cleanup intent only after the upload commit succeeds", async () => {
    const bucket = new FakeBucket();
    const objectKey = "storage-tests/success.txt";

    await withStorageUploadCompensation({
      db: env.DB,
      bucket: bucket as unknown as R2Bucket,
      bucketName: "assets",
      objectKey,
      upload: () => bucket.put(objectKey, "stored"),
      prepareCommitStatements: () => [successfulCommitStatement("storage_upload_committed")],
    });

    expect(bucket.has(objectKey)).toBe(true);
    expect(await queryAll(env.DB, "SELECT id FROM storage_deletion_outbox WHERE object_key = ?", objectKey)).toEqual(
      [],
    );
    expect(await queryAll(env.DB, "SELECT action FROM audit_log WHERE action = 'storage_upload_committed'")).toEqual([
      { action: "storage_upload_committed" },
    ]);
  });

  it("removes the object after a D1 failure without replacing the original error", async () => {
    const bucket = new FakeBucket();
    const objectKey = "storage-tests/commit-failure.txt";

    await expect(
      withStorageUploadCompensation({
        db: env.DB,
        bucket: bucket as unknown as R2Bucket,
        bucketName: "assets",
        objectKey,
        upload: () => bucket.put(objectKey, "stored"),
        prepareCommitStatements: () => [failingCommitStatement()],
      }),
    ).rejects.toThrow("NOT NULL constraint failed: audit_log.action");

    expect(bucket.has(objectKey)).toBe(false);
    expect(await queryAll(env.DB, "SELECT id FROM storage_deletion_outbox WHERE object_key = ?", objectKey)).toEqual(
      [],
    );
  });

  it("retains the pre-upload cleanup intent when immediate deletion fails and retries it", async () => {
    const bucket = new FakeBucket();
    bucket.deleteFailuresRemaining = 1;
    const objectKey = "storage-tests/retry.txt";

    await expect(
      withStorageUploadCompensation({
        db: env.DB,
        bucket: bucket as unknown as R2Bucket,
        bucketName: "assets",
        objectKey,
        upload: () => bucket.put(objectKey, "stored"),
        prepareCommitStatements: () => [failingCommitStatement()],
      }),
    ).rejects.toThrow("NOT NULL constraint failed: audit_log.action");

    expect(bucket.has(objectKey)).toBe(true);
    expect(
      await queryAll(env.DB, "SELECT object_key, status FROM storage_deletion_outbox WHERE object_key = ?", objectKey),
    ).toEqual([{ object_key: objectKey, status: "queued" }]);

    await env.DB.prepare("UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now') WHERE object_key = ?")
      .bind(objectKey)
      .run();
    await expect(
      processPendingStorageDeletions(env.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    expect(bucket.has(objectKey)).toBe(false);
  });

  it("rolls back dependent statements when a caller compare-and-set changes no rows", async () => {
    const bucket = new FakeBucket();
    bucket.deleteFailuresRemaining = 1;
    const objectKey = "storage-tests/lost-cas.txt";

    await expect(
      withStorageUploadCompensation({
        db: env.DB,
        bucket: bucket as unknown as R2Bucket,
        bucketName: "assets",
        objectKey,
        upload: () => bucket.put(objectKey, "stored"),
        prepareCommitStatements: () => [
          env.DB.prepare("UPDATE users SET updated_at = datetime('now') WHERE id = 'missing-user'"),
          prepareAuditLogAfterOneChange(
            env.DB,
            "system",
            null,
            "must_not_commit_after_lost_cas",
            "storage_test",
            null,
            null,
          ),
          successfulCommitStatement("dependent_statement_must_roll_back"),
        ],
      }),
    ).rejects.toThrow("NOT NULL constraint failed: audit_log.action");

    expect(bucket.has(objectKey)).toBe(true);
    expect(
      await queryAll(env.DB, "SELECT action FROM audit_log WHERE action LIKE '%must_%' OR action LIKE 'dependent_%'"),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT object_key, status FROM storage_deletion_outbox WHERE object_key = ?", objectKey),
    ).toEqual([{ object_key: objectKey, status: "queued" }]);

    await env.DB.prepare("UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now') WHERE object_key = ?")
      .bind(objectKey)
      .run();
    await processPendingStorageDeletions(env.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10);
    expect(bucket.has(objectKey)).toBe(false);
  });

  it("refuses to commit a pointer after the cleanup worker has claimed the object", async () => {
    const bucket = new FakeBucket();
    const objectKey = "storage-tests/claimed.txt";

    await expect(
      withStorageUploadCompensation({
        db: env.DB,
        bucket: bucket as unknown as R2Bucket,
        bucketName: "assets",
        objectKey,
        upload: async () => {
          await bucket.put(objectKey, "stored");
          await env.DB.prepare(
            `UPDATE storage_deletion_outbox
             SET status = 'deleting', processing_token = 'claimed',
                 lease_expires_at = datetime('now', '+5 minutes')
             WHERE bucket = 'assets' AND object_key = ?`,
          )
            .bind(objectKey)
            .run();
        },
        prepareCommitStatements: () => [successfulCommitStatement("must_not_commit")],
      }),
    ).rejects.toThrow("STORAGE_UPLOAD_COMPENSATION_UNAVAILABLE");

    expect(bucket.has(objectKey)).toBe(false);
    expect(await queryAll(env.DB, "SELECT action FROM audit_log WHERE action = 'must_not_commit'")).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT status, processing_token FROM storage_deletion_outbox WHERE object_key = ?",
        objectKey,
      ),
    ).toEqual([{ status: "deleting", processing_token: "claimed" }]);
  });
});
