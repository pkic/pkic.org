/**
 * Public headshot image endpoint.
 *
 * GET /api/v1/headshots/:userId/:file
 *
 * Serves headshot images from the SPEAKER_UPLOADS_BUCKET R2 bucket.
 * No authentication required, but only the user's current D1-referenced key
 * is served. Replaced and removed keys are revoked immediately even if their
 * asynchronous R2 cleanup needs a retry.
 */
import { json } from "../../../../_lib/http";
import { currentUserHeadshotResponse } from "../../../../_lib/services/user-headshot";

export async function onRequestGet(c: any): Promise<Response> {
  const userId = c.req.param("userId");
  const file = c.req.param("file");
  const r2Key = `headshots/${userId}/${file}`;

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    return json({ error: { code: "NOT_CONFIGURED", message: "Storage not configured" } }, 503);
  }

  return currentUserHeadshotResponse(c.env.DB, bucket, userId, r2Key);
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
