/**
 * POST /api/v1/admin/organizations/content-reviews/:id/approve.
 * Applies the proposed changes to the live organization row, promotes any
 * staged logo, and emails the submitter (org-content-approved).
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { approveContentReview } from "../../../../../../_lib/services/organization-content";
import {
  contentReviewApproveRouteSchema,
  contentReviewDecisionResponseSchema,
} from "../../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { processStorageDeletionForKey } from "../../../../../../_lib/services/storage-deletion-outbox";

export const OrganizationContentReviewApprovePost = openApiRoute(
  contentReviewApproveRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "organizations:content-review");

    const id = data.params.id;
    const result = await approveContentReview(db, id, admin);

    if (result.promotedLogoR2Key && result.previousLiveLogoR2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, result.previousLiveLogoR2Key, "assets"));
    }

    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));

    return json(contentReviewDecisionResponseSchema.parse({ review: result.review }));
  },
);
