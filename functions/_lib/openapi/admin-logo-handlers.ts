import { requireAdminFromRequest } from "../auth/admin";
import { requestDb, type AdminContext } from "../db/context";
import { AppError } from "../errors";
import { json } from "../http";
import { deleteStoredImageInBackground } from "../services/stored-image-pointer";
import type { AuthAdmin, DatabaseLike } from "../types";
import { readValidatedUploadedImage } from "../utils/image-upload";

interface LogoMutationResult {
  previousKey: string | null;
}

interface LogoReplacementResult extends LogoMutationResult {
  r2Key: string;
}

interface AdminLogoHandlersConfig {
  replaceLogo: (
    db: DatabaseLike,
    actor: AuthAdmin,
    bucket: R2Bucket,
    id: string,
    image: { buffer: ArrayBuffer; contentType: string },
  ) => Promise<LogoReplacementResult>;
  removeLogo: (db: DatabaseLike, actor: AuthAdmin, id: string) => Promise<LogoMutationResult>;
  publicLogoUrl: (id: string) => string;
}

/** Builds the identical authenticated PUT/DELETE transport around domain-specific logo services. */
export function buildAdminLogoHandlers(config: AdminLogoHandlersConfig) {
  async function onPut(c: AdminContext): Promise<Response> {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const bucket = c.env.ASSETS_BUCKET;
    if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
    const id = c.req.param("id");
    const result = await config.replaceLogo(db, actor, bucket, id, await readValidatedUploadedImage(c.req.raw, "Logo"));
    c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
    return json({ success: true, r2Key: result.r2Key, logoUrl: config.publicLogoUrl(id) });
  }

  async function onDelete(c: AdminContext): Promise<Response> {
    const db = requestDb(c);
    const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
    const result = await config.removeLogo(db, actor, c.req.param("id"));
    c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
    return json({ success: true });
  }

  async function onRequest(c: AdminContext): Promise<Response> {
    if (c.req.raw.method === "PUT") return onPut(c);
    if (c.req.raw.method === "DELETE") return onDelete(c);
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return { onPut, onDelete, onRequest };
}
