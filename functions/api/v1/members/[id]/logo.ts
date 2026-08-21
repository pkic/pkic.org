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
import { AppError } from "../../../../_lib/errors";
import { getMemberLogoR2Key } from "../../../../_lib/services/membership/directory";
import { memberLogoRouteSchema } from "../../../../../assets/shared/schemas/members-directory";
import { PUBLIC_IMAGE_CACHE_CONTROL, storedImageResponse } from "../../../../_lib/services/image-response";

// `headshots/...` keys are written by the admin self-service headshot upload
// endpoint (functions/api/v1/admin/users/[userId]/headshot.ts) into
// SPEAKER_UPLOADS_BUCKET. Every other prefix (member-photos/, org-logos/,
// sponsor-logos/) is written by scripts/migrate-members-yaml-to-d1.mjs into
// ASSETS_BUCKET. `users.headshot_r2_key` can be populated by either pipeline,
// so this picks the bucket that actually holds the key instead of assuming
// ASSETS_BUCKET for everything (which 404s on admin-uploaded headshots).
function bucketFor(c: any, r2Key: string): R2Bucket | undefined {
  return r2Key.startsWith("headshots/") ? c.env.SPEAKER_UPLOADS_BUCKET : c.env.ASSETS_BUCKET;
}

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const logoR2Key = await getMemberLogoR2Key(c.env.DB, id);
  if (!logoR2Key) {
    throw new AppError(404, "LOGO_NOT_FOUND", "No logo on file for this member");
  }

  const bucket = bucketFor(c, logoR2Key);
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Asset storage is not configured");
  }

  return storedImageResponse(bucket, logoR2Key, {
    notFoundCode: "LOGO_NOT_FOUND",
    notFoundMessage: "Logo file missing from storage",
    cacheControl: PUBLIC_IMAGE_CACHE_CONTROL,
  });
}

export const MembersIdLogoGet = openApiRoute(memberLogoRouteSchema, onRequestGet);
