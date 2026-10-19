/**
 * GET /api/v1/members/:id/logo
 *
 * Public member logo/photo, originally uploaded to R2 by the legacy member YAML
 * import or a future org-profile logo upload flow. `id`
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
import {
  IMMUTABLE_BRAND_IMAGE_CACHE_CONTROL,
  PERSON_PORTRAIT_CACHE_CONTROL,
  assertImageVersion,
  imageEntityTag,
  notModifiedImage,
  storedImageVersion,
  withImageEntityTag,
} from "../../../../_lib/services/image-cache";

/** An unversioned address of a person's photo: rechecked within five minutes so a removed photo stops showing. */
const CURRENT_PERSON_PHOTO_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";

/** A person's photo is rechecked by shared caches; an organization's logo is a public brand image. */
function logoCacheControl(person: boolean, versioned: boolean): string {
  if (person) return versioned ? PERSON_PORTRAIT_CACHE_CONTROL : CURRENT_PERSON_PHOTO_CACHE_CONTROL;
  return versioned ? IMMUTABLE_BRAND_IMAGE_CACHE_CONTROL : PUBLIC_IMAGE_CACHE_CONTROL;
}

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const version = new URL(c.req.raw.url).searchParams.get("v") ?? undefined;
  const logo = await getMemberLogoR2Key(c.env.DB, id);
  if (!logo) {
    throw new AppError(404, "LOGO_NOT_FOUND", "No logo on file for this member");
  }
  assertImageVersion(logo.key, version);
  const cacheControl = logoCacheControl(logo.person, version !== undefined);
  const entityTag = imageEntityTag(storedImageVersion(logo.key));
  const unchanged = notModifiedImage(c.req.raw, entityTag, cacheControl);
  if (unchanged) return unchanged;

  const bucket = requireProfileImageBucket(c.env, logo.key);

  const options = {
    notFoundCode: "LOGO_NOT_FOUND",
    notFoundMessage: "Logo file missing from storage",
    cacheControl,
  };
  return withImageEntityTag(
    logo.key.startsWith("headshots/")
      ? await storedRasterImageResponse(bucket, logo.key, options)
      : await storedImageResponse(bucket, logo.key, options),
    entityTag,
  );
}

export const MembersIdLogoGet = openApiRoute(memberLogoRouteSchema, onRequestGet);
