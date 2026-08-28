import { requireUserBackedAdminFromRequest } from "../auth/admin";
import { requirePermission } from "../auth/permissions";
import { requestDb, type AdminContext } from "../db/context";
import { AppError } from "../errors";
import { json } from "../http";
import { deleteStoredImageInBackground } from "../services/stored-image-pointer";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import { readValidatedUploadedImage } from "../utils/image-upload";
import { logoUploadResponseSchema } from "../../../assets/shared/schemas/images";
import { successResponseSchema } from "../../../assets/shared/schemas/api-common";

interface LogoMutationResult {
  previousKey: string | null;
}

interface LogoReplacementResult extends LogoMutationResult {
  r2Key: string;
}

interface OrganizationLogoHandlersConfig {
  replaceLogo: (
    db: DatabaseLike,
    actor: UserBackedAuthAdmin,
    bucket: R2Bucket,
    id: string,
    image: { buffer: ArrayBuffer; contentType: string },
  ) => Promise<LogoReplacementResult>;
  removeLogo: (db: DatabaseLike, actor: UserBackedAuthAdmin, id: string) => Promise<LogoMutationResult>;
  publicLogoUrl: (id: string) => string;
  idParam: string;
}

interface ValidatedLogoData {
  params: Record<string, string>;
}

/** Builds the identical authenticated PUT/DELETE transport around domain-specific logo services. */
export function buildOrganizationLogoHandlers(config: OrganizationLogoHandlersConfig) {
  async function onPut(c: AdminContext, data?: ValidatedLogoData): Promise<Response> {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(actor, "organizations:write");
    const bucket = c.env.ASSETS_BUCKET;
    if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
    const id = data?.params[config.idParam] ?? c.req.param(config.idParam);
    const result = await config.replaceLogo(db, actor, bucket, id, await readValidatedUploadedImage(c.req.raw, "Logo"));
    c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
    return json(
      logoUploadResponseSchema.parse({ success: true, r2Key: result.r2Key, logoUrl: config.publicLogoUrl(id) }),
    );
  }

  async function onDelete(c: AdminContext, data?: ValidatedLogoData): Promise<Response> {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(actor, "organizations:write");
    const result = await config.removeLogo(db, actor, data?.params[config.idParam] ?? c.req.param(config.idParam));
    c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
    return json(successResponseSchema.parse({ success: true }));
  }

  async function onRequest(c: AdminContext): Promise<Response> {
    if (c.req.raw.method === "PUT") return onPut(c);
    if (c.req.raw.method === "DELETE") return onDelete(c);
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return { onPut, onDelete, onRequest };
}
