import {
  sponsorshipLogoDeleteRouteSchema,
  sponsorshipLogoPutRouteSchema,
} from "../../../../../assets/shared/schemas/sponsorship-management";
import { deleteStoredImageInBackground } from "../../../../_lib/services/stored-image-pointer";
import {
  authorizedSponsorshipMutationDb,
  removeSponsorshipLogo,
  replaceSponsorshipLogo,
} from "../../../../_lib/services/sponsorship";
import { AppError } from "../../../../_lib/errors";
import { dispatchRequestMethod, json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { readValidatedUploadedImage } from "../../../../_lib/utils/image-upload";
import type { AdminContext } from "../../../../_lib/db/context";
import { logoUploadResponseSchema } from "../../../../../assets/shared/schemas/images";
import { successResponseSchema } from "../../../../../assets/shared/schemas/api-common";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

interface ValidatedLogoData {
  params: { id: string };
}

export async function onPut(c: AdminContext, data?: ValidatedLogoData): Promise<Response> {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");
  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  const id = data?.params.id ?? c.req.param("id");
  const result = await replaceSponsorshipLogo(
    authorizedSponsorshipMutationDb(db, staff),
    staff,
    bucket,
    id,
    await readValidatedUploadedImage(c.req.raw, "Logo"),
  );
  c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
  return json(
    logoUploadResponseSchema.parse({ success: true, r2Key: result.r2Key, logoUrl: `/api/v1/sponsors/${id}/logo` }),
  );
}

export async function onDelete(c: AdminContext, data?: ValidatedLogoData): Promise<Response> {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");
  const result = await removeSponsorshipLogo(
    authorizedSponsorshipMutationDb(db, staff),
    staff,
    data?.params.id ?? c.req.param("id"),
  );
  c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
  return json(successResponseSchema.parse({ success: true }));
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { PUT: onPut, DELETE: onDelete });
}

export const SponsorshipLogoPut = openApiRoute(sponsorshipLogoPutRouteSchema, onPut);
export const SponsorshipLogoDelete = openApiRoute(sponsorshipLogoDeleteRouteSchema, onDelete);
