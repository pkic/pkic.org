/**
 * POST /api/v1/me/organization/logo — propose a new organization logo.
 * Held in R2 under a staging key until a staff admin approves
 * the content review it's attached to — mirrors admin/organizations/[id]/
 * logo.ts's upload pipeline but writes to a staging key instead of the live
 * one, and folds into the org's moderation queue instead of applying
 * immediately.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { AppError } from "../../../../_lib/errors";
import { imageExtension, putUploadedImage, readValidatedUploadedImage } from "../../../../_lib/utils/image-upload";
import { requireOrgContact, stageOrganizationLogo } from "../../../../_lib/services/organization-content";
import { myOrganizationLogoUploadRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  enqueueStorageDeletion,
  processStorageDeletionForKey,
} from "../../../../_lib/services/storage-deletion-outbox";

export const MeOrganizationLogoPost = openApiRoute(myOrganizationLogoUploadRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  // Validate eligibility before touching R2 — avoids uploading an orphaned
  // object for a caller who turns out not to be an org contact.
  await requireOrgContact(db, member);

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const image = await readValidatedUploadedImage(c.req.raw, "Logo");
  const ext = imageExtension(image.contentType);
  const r2Key = `org-logos/${member.organizationId}/staging-${crypto.randomUUID()}.${ext}`;
  await putUploadedImage(bucket, r2Key, image, "logo");

  let previousStagingKey: string | null;
  try {
    ({ previousStagingKey } = await stageOrganizationLogo(db, member, r2Key));
  } catch (error) {
    try {
      await bucket.delete(r2Key);
    } catch {
      await enqueueStorageDeletion(db, r2Key, "assets");
    }
    throw error;
  }

  if (previousStagingKey && previousStagingKey !== r2Key) {
    c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, previousStagingKey, "assets"));
  }

  return json({ success: true, r2Key });
});
