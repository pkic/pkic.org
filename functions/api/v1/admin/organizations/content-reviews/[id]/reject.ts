/**
 * POST /api/v1/admin/organizations/content-reviews/:id/reject.
 * Leaves the live organization row untouched; emails the submitter
 * (org-content-rejected) with the reviewer's reason.
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { rejectContentReview } from "../../../../../../_lib/services/organization-content";
import {
  contentReviewDecisionResponseSchema,
  contentReviewRejectRouteSchema,
} from "../../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { processStorageDeletionForKey } from "../../../../../../_lib/services/storage-deletion-outbox";

export const OrganizationContentReviewRejectPost = openApiRoute(
  contentReviewRejectRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "organizations:content-review");

    const id = data.params.id;
    const body = data.body;
    const result = await rejectContentReview(db, id, admin, body.reviewerNote);

    if (result.staleLogoStagingR2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, result.staleLogoStagingR2Key, "assets"));
    }

    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));

    return json(contentReviewDecisionResponseSchema.parse({ review: result.review }));
  },
);
