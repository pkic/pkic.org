import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { uuid } from "../utils/ids";
import { imageExtension, putUploadedImage } from "../utils/image-upload";
import { nowIso } from "../utils/time";
import { prepareAuditLogWhen } from "./audit";
import {
  enqueueStorageDeletion,
  prepareStorageDeletion,
  processStorageDeletionForKey,
  type StorageBucketName,
} from "./storage-deletion-outbox";

export interface StoredImagePointerRow {
  id: string;
  object_key: string | null;
  [column: string]: unknown;
}

export interface StoredImagePointerDefinition {
  table: "organizations" | "sponsorships";
  pointerColumn: "logo_r2_key" | "non_member_logo_r2_key";
  extraColumns?: readonly string[];
  keyPrefix: string;
  entityType: "organization" | "sponsorship";
  notFoundCode: string;
  notFoundMessage: string;
}

interface StoredImageAudit {
  actorType: string;
  actorId: string | null;
  action: string;
  details?: Record<string, unknown>;
}

async function loadPointerRow(
  db: DatabaseLike,
  definition: StoredImagePointerDefinition,
  id: string,
): Promise<StoredImagePointerRow> {
  const extras = definition.extraColumns?.length ? `, ${definition.extraColumns.join(", ")}` : "";
  const row = await first<StoredImagePointerRow>(
    db,
    `SELECT id, ${definition.pointerColumn} AS object_key${extras} FROM ${definition.table} WHERE id = ?`,
    [id],
  );
  if (!row) throw new AppError(404, definition.notFoundCode, definition.notFoundMessage);
  return row;
}

export async function getStoredImagePointer(
  db: DatabaseLike,
  definition: StoredImagePointerDefinition,
  id: string,
): Promise<StoredImagePointerRow> {
  return loadPointerRow(db, definition, id);
}

export async function replaceStoredImagePointer(input: {
  db: DatabaseLike;
  bucket: R2Bucket;
  bucketName: StorageBucketName;
  definition: StoredImagePointerDefinition;
  id: string;
  image: { buffer: ArrayBuffer; contentType: string };
  audit: StoredImageAudit;
  validateRow?: (row: StoredImagePointerRow) => void;
}): Promise<{ r2Key: string; previousKey: string | null }> {
  const row = await loadPointerRow(input.db, input.definition, input.id);
  input.validateRow?.(row);
  const at = nowIso();
  const r2Key = `${input.definition.keyPrefix}/${row.id}/${uuid()}.${imageExtension(input.image.contentType)}`;
  await putUploadedImage(input.bucket, r2Key, input.image, "logo");
  try {
    const statements = [
      input.db
        .prepare(
          `UPDATE ${input.definition.table}
              SET ${input.definition.pointerColumn} = ?, updated_at = ?
            WHERE id = ? AND ${input.definition.pointerColumn} IS ?`,
        )
        .bind(r2Key, at, row.id, row.object_key),
      prepareAuditLogWhen(input.db, {
        actorType: input.audit.actorType,
        actorId: input.audit.actorId,
        action: input.audit.action,
        entityType: input.definition.entityType,
        entityId: row.id,
        details: { ...input.audit.details, r2Key },
        createdAt: at,
        conditionSql: `SELECT 1 FROM ${input.definition.table} WHERE id = ? AND ${input.definition.pointerColumn} = ?`,
        conditionBindings: [row.id, r2Key],
      }),
    ];
    const deletion = prepareStorageDeletion(input.db, row.object_key, at, input.bucketName);
    if (deletion) statements.push(deletion);
    const [updated] = await input.db.batch(statements);
    if ((updated.meta?.changes ?? 0) !== 1) {
      throw new AppError(409, "IMAGE_CHANGED", "The stored image changed while this request was processed");
    }
  } catch (error) {
    try {
      await input.bucket.delete(r2Key);
    } catch {
      await enqueueStorageDeletion(input.db, r2Key, input.bucketName);
    }
    throw error;
  }
  return { r2Key, previousKey: row.object_key };
}

export async function removeStoredImagePointer(input: {
  db: DatabaseLike;
  bucketName: StorageBucketName;
  definition: StoredImagePointerDefinition;
  id: string;
  audit: StoredImageAudit;
  validateRow?: (row: StoredImagePointerRow) => void;
}): Promise<{ previousKey: string | null }> {
  const row = await loadPointerRow(input.db, input.definition, input.id);
  input.validateRow?.(row);
  const at = nowIso();
  const statements = [
    input.db
      .prepare(
        `UPDATE ${input.definition.table}
            SET ${input.definition.pointerColumn} = NULL, updated_at = ?
          WHERE id = ? AND ${input.definition.pointerColumn} IS ?`,
      )
      .bind(at, row.id, row.object_key),
    prepareAuditLogWhen(input.db, {
      actorType: input.audit.actorType,
      actorId: input.audit.actorId,
      action: input.audit.action,
      entityType: input.definition.entityType,
      entityId: row.id,
      details: { ...input.audit.details, previousKey: row.object_key },
      createdAt: at,
      conditionSql: `SELECT 1 FROM ${input.definition.table} WHERE id = ? AND ${input.definition.pointerColumn} IS NULL AND updated_at = ?`,
      conditionBindings: [row.id, at],
    }),
  ];
  const deletion = prepareStorageDeletion(input.db, row.object_key, at, input.bucketName);
  if (deletion) statements.push(deletion);
  const [updated] = await input.db.batch(statements);
  if ((updated.meta?.changes ?? 0) !== 1) {
    throw new AppError(409, "IMAGE_CHANGED", "The stored image changed while this request was processed");
  }
  return { previousKey: row.object_key };
}

export function deleteStoredImageInBackground(
  db: DatabaseLike,
  env: { ASSETS_BUCKET?: R2Bucket; SPEAKER_UPLOADS_BUCKET?: R2Bucket },
  objectKey: string | null,
  bucketName: StorageBucketName,
): Promise<boolean> {
  return processStorageDeletionForKey(db, env, objectKey, bucketName);
}
