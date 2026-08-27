import {
  organizationContentReviewApproveRouteSchema,
  organizationContentReviewDecisionResponseSchema,
  organizationContentReviewGetRouteSchema,
  organizationContentReviewRejectRouteSchema,
  organizationContentReviewsListResponseSchema,
  organizationContentReviewsListRouteSchema,
} from "../../../../assets/shared/schemas/organization-content-reviews";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  approveContentReview,
  getContentReviewDetail,
  listContentReviews,
  rejectContentReview,
} from "../../../_lib/services/organization-content";
import { processStorageDeletionForKey } from "../../../_lib/services/storage-deletion-outbox";

async function requireContentReviewer(c: AdminContext) {
  const db = requestDb(c);
  const reviewer = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(reviewer, "organizations:content-review");
  return { db, reviewer };
}

export const SystemOrganizationContentReviewsList = openApiRoute(
  organizationContentReviewsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireContentReviewer(c);
    const { reviews, total } = await listContentReviews(db, data.query);

    return json(
      organizationContentReviewsListResponseSchema.parse({
        reviews,
        page: buildPageInfo(data.query.limit, data.query.offset, total, reviews.length),
      }),
    );
  },
);

export const SystemOrganizationContentReviewGet = openApiRoute(
  organizationContentReviewGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireContentReviewer(c);
    return json({ review: await getContentReviewDetail(db, data.params.id) });
  },
);

export const SystemOrganizationContentReviewApprove = openApiRoute(
  organizationContentReviewApproveRouteSchema,
  async (c: AdminContext, data) => {
    const { db, reviewer } = await requireContentReviewer(c);
    const result = await approveContentReview(db, data.params.id, reviewer);

    if (result.promotedLogoR2Key && result.previousLiveLogoR2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, result.previousLiveLogoR2Key, "assets"));
    }
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));

    return json(organizationContentReviewDecisionResponseSchema.parse({ review: result.review }));
  },
);

export const SystemOrganizationContentReviewReject = openApiRoute(
  organizationContentReviewRejectRouteSchema,
  async (c: AdminContext, data) => {
    const { db, reviewer } = await requireContentReviewer(c);
    const result = await rejectContentReview(db, data.params.id, reviewer, data.body.reviewerNote);

    if (result.staleLogoStagingR2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, result.staleLogoStagingR2Key, "assets"));
    }
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));

    return json(organizationContentReviewDecisionResponseSchema.parse({ review: result.review }));
  },
);
