import {
  organizationManagementLogoDeleteRouteSchema,
  organizationManagementLogoPutRouteSchema,
} from "../../../../../assets/shared/schemas/organization-management";
import {
  organizationLogoReviewCreateRouteSchema,
  organizationLogoReviewResponseSchema,
} from "../../../../../assets/shared/schemas/organization-self-service";
import { getConfig } from "../../../../_lib/config";
import type { AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { buildManagementLink } from "../../../../_lib/services/management-links";
import {
  prepareAuthorizedOrganizationLogoStage,
  processOrganizationContentReviewNotificationsBackground,
  requireOrgContact,
} from "../../../../_lib/services/organization-content";
import { buildOrganizationLogoHandlers } from "../../../../_lib/openapi/organization-logo-handlers";
import { removeOrganizationLogo, replaceOrganizationLogo } from "../../../../_lib/services/organization-logo";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  processStorageDeletionForKey,
  withStorageUploadCompensation,
} from "../../../../_lib/services/storage-deletion-outbox";
import { imageExtension, putUploadedImage, readValidatedUploadedSvgLogo } from "../../../../_lib/utils/image-upload";
import { requireOrganizationMemberMutation } from "../authorization";

export const { onPut, onDelete, onRequest } = buildOrganizationLogoHandlers({
  replaceLogo: replaceOrganizationLogo,
  removeLogo: removeOrganizationLogo,
  publicLogoUrl: (id) => `/api/v1/members/${id}/logo`,
  idParam: "organizationId",
});

export const OrganizationLogoPut = openApiRoute(organizationManagementLogoPutRouteSchema, onPut);
export const OrganizationLogoDelete = openApiRoute(organizationManagementLogoDeleteRouteSchema, onDelete);

export const OrganizationLogoReviewPost = openApiRoute(
  organizationLogoReviewCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMemberMutation(c, data.params.organizationId);
    const organization = await requireOrgContact(db, member);
    const bucket = c.env.ASSETS_BUCKET;
    if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

    const image = await readValidatedUploadedSvgLogo(c.req.raw);
    const extension = imageExtension(image.contentType);
    const r2Key = `org-logos/${organization.id}/staging-${crypto.randomUUID()}.${extension}`;
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

    if (prepared.previousStagingKey && prepared.previousStagingKey !== r2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, prepared.previousStagingKey, "assets"));
    }
    c.executionCtx.waitUntil(processOrganizationContentReviewNotificationsBackground(db, c.env));
    return json(organizationLogoReviewResponseSchema.parse({ success: true }));
  },
);
