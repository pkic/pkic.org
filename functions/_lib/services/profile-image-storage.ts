import type { Env } from "../types";
import { AppError } from "../errors";
import type { StorageBucketName } from "./storage-deletion-outbox";

/** Uploads and migrated portraits share pointers, but live in different R2 buckets. */
export function profileImageBucketName(key: string | null): StorageBucketName {
  return key?.startsWith("headshots/") ? "speaker_uploads" : "assets";
}

export function requireProfileImageBucket(
  env: Pick<Env, "ASSETS_BUCKET" | "SPEAKER_UPLOADS_BUCKET">,
  key: string,
): R2Bucket {
  const bucket = profileImageBucketName(key) === "speaker_uploads" ? env.SPEAKER_UPLOADS_BUCKET : env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Image storage is not configured");
  return bucket;
}
