import type { DatabaseLike } from "../types";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { imageExtension, putUploadedImage } from "../utils/image-upload";
import { first } from "../db/queries";
import { prepareAuditLogWhen } from "./audit";
import { storedImageResponse } from "./image-response";
import {
  enqueueStorageDeletion,
  prepareStorageDeletion,
  processStorageDeletionForKey,
} from "./storage-deletion-outbox";
import type { Env, StatementLike } from "../types";
import { resolveAppBaseUrl } from "../config";
import { prepareBadgeRenderJobsForUser } from "./badge-render-job-statements";

export interface HeadshotAudit {
  actorType: string;
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

export interface UserHeadshotContext {
  db: DatabaseLike;
  bucket: R2Bucket;
  userId: string;
  previousKey: string | null;
  audit: HeadshotAudit;
}

export interface UserHeadshotRecord {
  id: string;
  email: string;
  headshot_r2_key: string | null;
}

export function requireUserHeadshotBucket(env: Pick<Env, "SPEAKER_UPLOADS_BUCKET">): R2Bucket {
  const bucket = env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  return bucket;
}

export function privateUserHeadshotResponse(bucket: R2Bucket, key: string): Promise<Response> {
  return storedImageResponse(bucket, key, {
    notFoundCode: "NOT_FOUND",
    notFoundMessage: "Headshot file missing from storage",
    cacheControl: "private, max-age=3600",
  });
}

export function publicUserHeadshotUrl(
  appBaseUrl: string,
  storageKey: string | null,
  updatedAt?: string | null,
): string | null {
  if (!storageKey) return null;
  const segments = storageKey.split("/").filter(Boolean);
  if (segments[0] === "headshots") segments.shift();
  if (segments.length < 2) return null;

  const url = new URL(
    `/api/v1/headshots/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`,
    appBaseUrl,
  );
  if (updatedAt) url.searchParams.set("v", updatedAt);
  return url.toString();
}

export async function getUserHeadshotRecord(db: DatabaseLike, userId: string): Promise<UserHeadshotRecord> {
  const row = await first<UserHeadshotRecord>(db, "SELECT id, email, headshot_r2_key FROM users WHERE id = ?", [
    userId,
  ]);
  if (!row) throw new AppError(404, "NOT_FOUND", "User not found");
  return row;
}

export async function getUserHeadshotPointer(db: DatabaseLike, userId: string): Promise<string | null> {
  return (await getUserHeadshotRecord(db, userId)).headshot_r2_key;
}

export async function adminUserHeadshotResponse(db: DatabaseLike, bucket: R2Bucket, userId: string) {
  const user = await getUserHeadshotRecord(db, userId);
  if (!user.headshot_r2_key) throw new AppError(404, "NOT_FOUND", "No headshot on file");
  return privateUserHeadshotResponse(bucket, user.headshot_r2_key);
}

function conditionalHeadshotAuditStatement(
  db: DatabaseLike,
  userId: string,
  audit: HeadshotAudit,
  details: Record<string, unknown>,
  at: string,
  conditionSql: string,
  conditionValues: unknown[],
): StatementLike {
  return prepareAuditLogWhen(db, {
    actorType: audit.actorType,
    actorId: audit.actorId,
    action: audit.action,
    entityType: audit.entityType ?? "user",
    entityId: audit.entityId ?? userId,
    details: { ...audit.details, ...details },
    createdAt: at,
    conditionSql: `SELECT 1 FROM users WHERE id = ? AND ${conditionSql}`,
    conditionBindings: [userId, ...conditionValues],
  });
}

async function headshotConflictError(db: DatabaseLike, userId: string): Promise<AppError> {
  const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [userId]);
  return user
    ? new AppError(409, "HEADSHOT_CHANGED", "The headshot changed while this request was being processed")
    : new AppError(404, "NOT_FOUND", "User not found");
}

/**
 * Stores a new object before atomically committing its D1 reference and audit.
 * A D1 failure removes the new object; callers may remove the previous object
 * only after this function succeeds.
 */
export async function replaceUserHeadshot(
  context: UserHeadshotContext & {
    image: { buffer: ArrayBuffer; contentType: string };
    source?: string;
  },
): Promise<string> {
  const at = nowIso();
  const extension = imageExtension(context.image.contentType);
  const r2Key = `headshots/${context.userId}/${at.replace(/[:.]/g, "-")}-${uuid().slice(0, 8)}.${extension}`;
  await putUploadedImage(
    context.bucket,
    r2Key,
    context.image,
    "headshot",
    context.source ? { source: context.source } : undefined,
  );

  try {
    const statements = [
      context.db
        .prepare(
          `UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ?
           WHERE id = ? AND headshot_r2_key IS ?`,
        )
        .bind(r2Key, at, at, context.userId, context.previousKey),
      conditionalHeadshotAuditStatement(
        context.db,
        context.userId,
        context.audit,
        { r2Key },
        at,
        "headshot_r2_key = ?",
        [r2Key],
      ),
      prepareBadgeRenderJobsForUser(context.db, context.userId, at),
    ];
    const deletionStatement = prepareStorageDeletion(context.db, context.previousKey, at);
    if (deletionStatement) statements.push(deletionStatement);
    const [updateResult] = await context.db.batch(statements);
    if ((updateResult.meta?.changes ?? 0) !== 1) {
      throw await headshotConflictError(context.db, context.userId);
    }
  } catch (error) {
    try {
      await context.bucket.delete(r2Key);
    } catch {
      await enqueueStorageDeletion(context.db, r2Key);
    }
    throw error;
  }

  return r2Key;
}

/** Clears the D1 reference and records the audit before an R2 object is removed. */
export async function removeUserHeadshot(context: Omit<UserHeadshotContext, "bucket">): Promise<void> {
  const at = nowIso();
  const statements = [
    context.db
      .prepare(
        `UPDATE users SET headshot_r2_key = NULL, headshot_updated_at = ?, updated_at = ?
         WHERE id = ? AND headshot_r2_key IS ?`,
      )
      .bind(at, at, context.userId, context.previousKey),
    conditionalHeadshotAuditStatement(
      context.db,
      context.userId,
      context.audit,
      { previousKey: context.previousKey },
      at,
      "headshot_r2_key IS NULL AND headshot_updated_at = ?",
      [at],
    ),
    prepareBadgeRenderJobsForUser(context.db, context.userId, at),
  ];
  const deletionStatement = prepareStorageDeletion(context.db, context.previousKey, at);
  if (deletionStatement) statements.push(deletionStatement);
  const [updateResult] = await context.db.batch(statements);
  if ((updateResult.meta?.changes ?? 0) !== 1) {
    throw await headshotConflictError(context.db, context.userId);
  }
}

export function removePreviousHeadshot(
  db: DatabaseLike,
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET">,
  previousKey: string | null,
): Promise<boolean> {
  return processStorageDeletionForKey(db, env, previousKey);
}

/** Opportunistically processes durable object deletion after the D1 commit. */
export function finalizeUserHeadshotChange(
  context: {
    db: DatabaseLike;
    env: Env;
    origin: string;
    userId: string;
    previousKey: string | null;
  },
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  waitUntil(removePreviousHeadshot(context.db, context.env, context.previousKey));
}

export async function commitUserHeadshotUpload(
  context: Omit<UserHeadshotContext, "bucket"> & {
    env: Env;
    origin: string;
    image: { buffer: ArrayBuffer; contentType: string };
    source?: string;
  },
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<string> {
  const r2Key = await replaceUserHeadshot({
    db: context.db,
    bucket: requireUserHeadshotBucket(context.env),
    userId: context.userId,
    previousKey: context.previousKey,
    image: context.image,
    source: context.source,
    audit: context.audit,
  });
  finalizeUserHeadshotChange(context, waitUntil);
  return r2Key;
}

export async function commitUserHeadshotRemoval(
  context: Omit<UserHeadshotContext, "bucket"> & { env: Env; origin: string },
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<void> {
  await removeUserHeadshot(context);
  finalizeUserHeadshotChange(context, waitUntil);
}

export async function uploadUserHeadshotForRequest(
  db: DatabaseLike,
  env: Env,
  request: Request,
  waitUntil: (promise: Promise<unknown>) => void,
  payload: {
    userId: string;
    previousKey: string | null;
    image: { buffer: ArrayBuffer; contentType: string };
    source?: string;
    audit: HeadshotAudit;
  },
): Promise<{ r2Key: string; origin: string }> {
  const origin = resolveAppBaseUrl(env, request);
  const r2Key = await commitUserHeadshotUpload({ db, env, origin, ...payload }, waitUntil);
  return { r2Key, origin };
}

export function removeUserHeadshotForRequest(
  db: DatabaseLike,
  env: Env,
  request: Request,
  waitUntil: (promise: Promise<unknown>) => void,
  payload: { userId: string; previousKey: string | null; audit: HeadshotAudit },
): Promise<void> {
  return commitUserHeadshotRemoval({ db, env, origin: resolveAppBaseUrl(env, request), ...payload }, waitUntil);
}

export async function currentUserHeadshotResponse(
  db: DatabaseLike,
  bucket: R2Bucket,
  userId: string,
  requestedKey: string,
): Promise<Response> {
  const current = await first<{ headshot_r2_key: string | null }>(
    db,
    "SELECT headshot_r2_key FROM users WHERE id = ?",
    [userId],
  );
  if (current?.headshot_r2_key !== requestedKey) {
    throw new AppError(404, "NOT_FOUND", "Headshot not found");
  }
  return storedImageResponse(bucket, requestedKey, {
    notFoundCode: "NOT_FOUND",
    notFoundMessage: "Headshot not found",
    cacheControl: "public, max-age=300, s-maxage=300, must-revalidate",
  });
}
