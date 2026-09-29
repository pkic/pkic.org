import type { DatabaseLike } from "../types";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { imageExtension, putUploadedImage } from "../utils/image-upload";
import { first } from "../db/queries";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange, type AuditScope } from "./audit";
import { storedRasterImageResponse } from "./image-response";
import { profileImageBucketName, requireProfileImageBucket } from "./profile-image-storage";
import {
  prepareStorageDeletion,
  processStorageDeletionForKey,
  withStorageUploadCompensation,
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
  scope?: AuditScope;
  details?: Record<string, unknown>;
}

export interface UserHeadshotContext {
  db: DatabaseLike;
  bucket: R2Bucket;
  userId: string;
  previousKey: string | null;
  audit: HeadshotAudit;
  commitGuard?: { sql: string; bindings: unknown[] };
  prepareAdditionalCommitStatements?: (at: string) => StatementLike[];
}

export interface UserHeadshotRecord {
  id: string;
  email: string;
  headshot_r2_key: string | null;
  pii_redacted_at: string | null;
  merged_into_user_id: string | null;
  updated_at: string;
}

export function requireUserHeadshotBucket(env: Pick<Env, "SPEAKER_UPLOADS_BUCKET">): R2Bucket {
  const bucket = env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  return bucket;
}

export function privateUserHeadshotResponse(bucket: R2Bucket, key: string): Promise<Response> {
  return storedRasterImageResponse(bucket, key, {
    notFoundCode: "NOT_FOUND",
    notFoundMessage: "Headshot file missing from storage",
    cacheControl: "private, max-age=3600",
  });
}

/**
 * The file a stored headshot key names — its last segment, and the part that
 * changes whenever the photograph does.
 *
 * A key must carry a prefix: a bare filename names no owner and is not
 * addressable.
 */
export function userHeadshotKeyFile(storageKey: string | null): string | null {
  if (!storageKey) return null;
  const segments = storageKey.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return segments[segments.length - 1];
}

/**
 * The public address of a user's current headshot.
 *
 * The owner comes from the row, never from the key. A self-service or staff
 * upload writes `headshots/<userId>/<file>`, but the member migration writes
 * `member-photos/<orgSlug>/<file>` for a portrait it carried over from the
 * repository (scripts/migrate-members/individuals.mjs). Reading the id out of
 * the key turned those into `/api/v1/users/member-photos/headshots/…`, an
 * address for a user that does not exist — which is why a migrated portrait
 * appeared on the public members page and nowhere in the portal (issue #28).
 *
 * The file segment is what makes a replaced or removed headshot's address stop
 * resolving, and it doubles as the cache key: `currentUserHeadshotResponse`
 * serves only the key the row holds right now.
 */
export function publicUserHeadshotPath(userId: string, storageKey: string | null): string | null {
  const file = userHeadshotKeyFile(storageKey);
  if (!file) return null;
  return `/api/v1/users/${encodeURIComponent(userId)}/headshots/${encodeURIComponent(file)}`;
}

export function publicUserHeadshotUrl(
  appBaseUrl: string,
  userId: string,
  storageKey: string | null,
  updatedAt?: string | null,
): string | null {
  const path = publicUserHeadshotPath(userId, storageKey);
  if (!path) return null;
  const url = new URL(path, appBaseUrl);
  if (updatedAt) url.searchParams.set("v", updatedAt);
  return url.toString();
}

export async function getUserHeadshotRecord(db: DatabaseLike, userId: string): Promise<UserHeadshotRecord> {
  const row = await first<UserHeadshotRecord>(
    db,
    "SELECT id, email, headshot_r2_key, pii_redacted_at, merged_into_user_id, updated_at FROM users WHERE id = ?",
    [userId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "User not found");
  return row;
}

/** Rechecks that the target identity is still live when committing its image pointer. */
export function userHeadshotTargetGuard(user: UserHeadshotRecord): { sql: string; bindings: unknown[] } {
  return {
    sql: "pii_redacted_at IS NULL AND merged_into_user_id IS NULL AND updated_at = ?",
    bindings: [user.updated_at],
  };
}

export async function getUserHeadshotPointer(db: DatabaseLike, userId: string): Promise<string | null> {
  return (await getUserHeadshotRecord(db, userId)).headshot_r2_key;
}

export async function userHeadshotResponse(
  db: DatabaseLike,
  env: Pick<Env, "ASSETS_BUCKET" | "SPEAKER_UPLOADS_BUCKET">,
  userId: string,
) {
  const user = await getUserHeadshotRecord(db, userId);
  if (!user.headshot_r2_key) throw new AppError(404, "NOT_FOUND", "No headshot on file");
  return privateUserHeadshotResponse(requireProfileImageBucket(env, user.headshot_r2_key), user.headshot_r2_key);
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
  try {
    await withStorageUploadCompensation({
      db: context.db,
      bucket: context.bucket,
      bucketName: "speaker_uploads",
      objectKey: r2Key,
      upload: () =>
        putUploadedImage(
          context.bucket,
          r2Key,
          context.image,
          "headshot",
          context.source ? { source: context.source } : undefined,
        ),
      prepareCommitStatements: () => {
        const statements = [
          context.db
            .prepare(
              `UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ?
           WHERE id = ? AND headshot_r2_key IS ?${context.commitGuard ? ` AND ${context.commitGuard.sql}` : ""}`,
            )
            .bind(r2Key, at, at, context.userId, context.previousKey, ...(context.commitGuard?.bindings ?? [])),
          prepareAuditLogAfterOneChange(
            context.db,
            context.audit.actorType,
            context.audit.actorId,
            context.audit.action,
            context.audit.entityType ?? "user",
            context.audit.entityId ?? context.userId,
            { ...context.audit.details, r2Key },
            at,
            context.audit.scope,
          ),
          prepareBadgeRenderJobsForUser(context.db, context.userId, at),
          ...(context.prepareAdditionalCommitStatements?.(at) ?? []),
        ];
        const deletionStatement = prepareStorageDeletion(
          context.db,
          context.previousKey,
          at,
          profileImageBucketName(context.previousKey),
        );
        if (deletionStatement) statements.push(deletionStatement);
        return statements;
      },
    });
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw await headshotConflictError(context.db, context.userId);
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
         WHERE id = ? AND headshot_r2_key IS ?${context.commitGuard ? ` AND ${context.commitGuard.sql}` : ""}`,
      )
      .bind(at, at, context.userId, context.previousKey, ...(context.commitGuard?.bindings ?? [])),
    prepareAuditLogAfterOneChange(
      context.db,
      context.audit.actorType,
      context.audit.actorId,
      context.audit.action,
      context.audit.entityType ?? "user",
      context.audit.entityId ?? context.userId,
      { ...context.audit.details, previousKey: context.previousKey },
      at,
      context.audit.scope,
    ),
    prepareBadgeRenderJobsForUser(context.db, context.userId, at),
    ...(context.prepareAdditionalCommitStatements?.(at) ?? []),
  ];
  const deletionStatement = prepareStorageDeletion(
    context.db,
    context.previousKey,
    at,
    profileImageBucketName(context.previousKey),
  );
  if (deletionStatement) statements.push(deletionStatement);
  let updateResult;
  try {
    [updateResult] = await context.db.batch(statements);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw await headshotConflictError(context.db, context.userId);
    }
    throw error;
  }
  if ((updateResult.meta?.changes ?? 0) !== 1) {
    throw await headshotConflictError(context.db, context.userId);
  }
}

export function removePreviousHeadshot(
  db: DatabaseLike,
  env: Pick<Env, "SPEAKER_UPLOADS_BUCKET" | "ASSETS_BUCKET">,
  previousKey: string | null,
): Promise<boolean> {
  return processStorageDeletionForKey(db, env, previousKey, profileImageBucketName(previousKey));
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
    commitGuard: context.commitGuard,
    prepareAdditionalCommitStatements: context.prepareAdditionalCommitStatements,
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
    commitGuard?: { sql: string; bindings: unknown[] };
    prepareAdditionalCommitStatements?: (at: string) => StatementLike[];
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
  payload: {
    userId: string;
    previousKey: string | null;
    audit: HeadshotAudit;
    commitGuard?: { sql: string; bindings: unknown[] };
    prepareAdditionalCommitStatements?: (at: string) => StatementLike[];
  },
): Promise<void> {
  return commitUserHeadshotRemoval({ db, env, origin: resolveAppBaseUrl(env, request), ...payload }, waitUntil);
}

/**
 * Serves the headshot the user's row points at right now, addressed by the
 * file that key names.
 *
 * The stored key is read rather than rebuilt from the URL. Rebuilding assumed
 * every key looked like `headshots/<userId>/<file>`, so a key from any other
 * writer — the member migration's `member-photos/<orgSlug>/<file>` — could
 * never be served at all. Comparing the file segment keeps what the rebuild
 * was for: a replaced or removed photograph's address stops resolving at once,
 * because the row no longer names that file.
 */
export async function currentUserHeadshotResponse(
  db: DatabaseLike,
  env: Pick<Env, "ASSETS_BUCKET" | "SPEAKER_UPLOADS_BUCKET">,
  userId: string,
  requestedFile: string,
): Promise<Response> {
  const current = await first<{ headshot_r2_key: string | null }>(
    db,
    "SELECT headshot_r2_key FROM users WHERE id = ?",
    [userId],
  );
  const storedKey = current?.headshot_r2_key ?? null;
  if (!storedKey || userHeadshotKeyFile(storedKey) !== requestedFile) {
    throw new AppError(404, "NOT_FOUND", "Headshot not found");
  }
  return storedRasterImageResponse(requireProfileImageBucket(env, storedKey), storedKey, {
    notFoundCode: "NOT_FOUND",
    notFoundMessage: "Headshot not found",
    cacheControl: "public, max-age=300, s-maxage=300, must-revalidate",
  });
}
