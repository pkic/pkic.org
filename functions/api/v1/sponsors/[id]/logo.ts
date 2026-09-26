/**
 * GET /api/v1/sponsors/:id/logo
 *
 * Public non-member sponsor logo. `id` is a `sponsorships.id` — org-tied
 * (consortium or member-linked event) sponsors already have a logo at
 * GET /api/v1/members/:id/logo, since they're backed by an organizations row.
 */
import { AppError } from "../../../../_lib/errors";
import { getNonMemberSponsorLogoR2Key } from "../../../../_lib/services/public-sponsors";
import { sponsorLogoRouteSchema } from "../../../../../assets/shared/schemas/public-sponsors";
import {
  sponsorshipLogoDeleteRouteSchema,
  sponsorshipLogoPutRouteSchema,
} from "../../../../../assets/shared/schemas/sponsorship-management";
import { logoUploadResponseSchema } from "../../../../../assets/shared/schemas/images";
import { successResponseSchema } from "../../../../../assets/shared/schemas/api-common";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import {
  authorizedSponsorshipMutationDb,
  removeSponsorshipLogo,
  replaceSponsorshipLogo,
} from "../../../../_lib/services/sponsorship";
import { deleteStoredImageInBackground } from "../../../../_lib/services/stored-image-pointer";
import { PUBLIC_IMAGE_CACHE_CONTROL, storedImageResponse } from "../../../../_lib/services/image-response";
import { readValidatedUploadedSvgLogo } from "../../../../_lib/utils/image-upload";

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const logoR2Key = await getNonMemberSponsorLogoR2Key(c.env.DB, id);
  if (!logoR2Key) {
    throw new AppError(404, "LOGO_NOT_FOUND", "No logo on file for this sponsor");
  }

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Asset storage is not configured");
  }

  return storedImageResponse(bucket, logoR2Key, {
    notFoundCode: "LOGO_NOT_FOUND",
    notFoundMessage: "Logo file missing from storage",
    cacheControl: PUBLIC_IMAGE_CACHE_CONTROL,
  });
}

// Thin openApiRoute wrap — onRequestGet is imported directly by
// tests/public-sponsors-api.test.ts, so it stays untouched. GET has no
// request body, so wrapping is safe.
export const SponsorsIdLogoGet = openApiRoute(sponsorLogoRouteSchema, (c: any) => onRequestGet(c));

export const SponsorsIdLogoPut = openApiRoute(sponsorshipLogoPutRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");
  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  const id = data.params.id;
  const result = await replaceSponsorshipLogo(
    authorizedSponsorshipMutationDb(db, staff),
    staff,
    bucket,
    id,
    await readValidatedUploadedSvgLogo(c.req.raw),
  );
  c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
  return json(
    logoUploadResponseSchema.parse({ success: true, r2Key: result.r2Key, logoUrl: `/api/v1/sponsors/${id}/logo` }),
  );
});

export const SponsorsIdLogoDelete = openApiRoute(sponsorshipLogoDeleteRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "sponsorships:write");
  const result = await removeSponsorshipLogo(authorizedSponsorshipMutationDb(db, staff), staff, data.params.id);
  c.executionCtx.waitUntil(deleteStoredImageInBackground(db, c.env, result.previousKey, "assets"));
  return json(successResponseSchema.parse({ success: true }));
});
