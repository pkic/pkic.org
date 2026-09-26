/**
 * GET /api/v1/members/:id/logo
 *
 * Public member logo/photo, uploaded to R2 by scripts/migrate-members-yaml-to-d1.mjs
 * (--upload-logos) or a future org-profile logo upload flow. `id`
 * matches the `id` field on GET /members and /:id — an organization id for
 * org-tied members, or the member row id for org-less individuals
 * (H5/H6/H7), whose photo is their own `users.headshot_r2_key`.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireProfileImageBucket } from "../../../../_lib/services/profile-image-storage";
import { AppError } from "../../../../_lib/errors";
import { getMemberLogoR2Key } from "../../../../_lib/services/membership/directory";
import { memberLogoRouteSchema } from "../../../../../assets/shared/schemas/members-directory";
import {
  PUBLIC_IMAGE_CACHE_CONTROL,
  storedImageResponse,
  storedRasterImageResponse,
} from "../../../../_lib/services/image-response";

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const logoR2Key = await getMemberLogoR2Key(c.env.DB, id);
  if (!logoR2Key) {
    throw new AppError(404, "LOGO_NOT_FOUND", "No logo on file for this member");
  }

  const bucket = requireProfileImageBucket(c.env, logoR2Key);

  const options = {
    notFoundCode: "LOGO_NOT_FOUND",
    notFoundMessage: "Logo file missing from storage",
    cacheControl: PUBLIC_IMAGE_CACHE_CONTROL,
  };
  return logoR2Key.startsWith("headshots/")
    ? storedRasterImageResponse(bucket, logoR2Key, options)
    : storedImageResponse(bucket, logoR2Key, options);
}

export const MembersIdLogoGet = openApiRoute(memberLogoRouteSchema, onRequestGet);
