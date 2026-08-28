/**
 * POST /api/v1/me/organization/logo — propose a new organization logo.
 * Held in R2 under a staging key until a staff admin approves
 * the content review it's attached to — mirrors the canonical organization logo route.
 * logo.ts's upload pipeline but writes to a staging key instead of the live
 * one, and folds into the org's moderation queue instead of applying
 * immediately.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { getConfig } from "../../../../_lib/config";
import { AppError } from "../../../../_lib/errors";
import { imageExtension, putUploadedImage, readValidatedUploadedImage } from "../../../../_lib/utils/image-upload";
import {
  prepareAuthorizedOrganizationLogoStage,
  processOrganizationContentReviewNotificationsBackground,
  requireOrgContact,
} from "../../../../_lib/services/organization-content";
import {
  myOrganizationLogoUploadResponseSchema,
  myOrganizationLogoUploadRouteSchema,
} from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  processStorageDeletionForKey,
  withStorageUploadCompensation,
} from "../../../../_lib/services/storage-deletion-outbox";
import { buildManagementLink } from "../../../../_lib/services/management-links";

export const MeOrganizationLogoPost = openApiRoute(myOrganizationLogoUploadRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  // Validate eligibility before touching R2 — avoids uploading an orphaned
  // object for a caller who turns out not to be an org contact.
  const organization = await requireOrgContact(db, member);

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const image = await readValidatedUploadedImage(c.req.raw, "Logo");
  const ext = imageExtension(image.contentType);
  const r2Key = `org-logos/${organization.id}/staging-${crypto.randomUUID()}.${ext}`;
  const reviewUrl = buildManagementLink(getConfig(c.env, c.req.raw).appBaseUrl, {
    kind: "organization-content-reviews",
  });
  const prepared = await prepareAuthorizedOrganizationLogoStage(db, member, organization.id, r2Key, reviewUrl);

  try {
    await withStorageUploadCompensation({
      db,
      bucket,
      bucketName: "assets",
      objectKey: r2Key,
      upload: () => putUploadedImage(bucket, r2Key, image, "logo"),
      prepareCommitStatements: () => prepared.statements,
    });
  } catch (error) {
    throw prepared.mapCommitError(error);
  }

  const { previousStagingKey } = prepared;
  if (previousStagingKey && previousStagingKey !== r2Key) {
    c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, previousStagingKey, "assets"));
  }

  c.executionCtx.waitUntil(processOrganizationContentReviewNotificationsBackground(db, c.env));

  return json(myOrganizationLogoUploadResponseSchema.parse({ success: true, r2Key }));
});
