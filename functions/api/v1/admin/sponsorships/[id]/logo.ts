import {
  sponsorshipLogoDeleteRouteSchema,
  sponsorshipLogoPutRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-sponsorships";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { replaceSponsorshipLogo, removeSponsorshipLogo } from "../../../../../_lib/services/sponsorship/logo";
import { deleteStoredImageInBackground } from "../../../../../_lib/services/stored-image-pointer";
import { readValidatedUploadedImage } from "../../../../../_lib/utils/image-upload";

async function onPut(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  const result = await replaceSponsorshipLogo(
    db,
    actor,
    bucket,
    c.req.param("id"),
    await readValidatedUploadedImage(c.req.raw, "Logo"),
  );
  c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
  return json({ success: true, r2Key: result.r2Key, logoUrl: `/api/v1/sponsors/${c.req.param("id")}/logo` });
}

async function onDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await removeSponsorshipLogo(db, actor, c.req.param("id"));
  c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "PUT") return onPut(c);
  if (c.req.raw.method === "DELETE") return onDelete(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

export const SponsorshipLogoPut = openApiRoute(sponsorshipLogoPutRouteSchema, onPut);
export const SponsorshipLogoDelete = openApiRoute(sponsorshipLogoDeleteRouteSchema, onDelete);
