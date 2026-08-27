import {
  organizationContentReviewApproveRouteSchema,
  organizationContentReviewDecisionResponseSchema,
  organizationContentReviewGetRouteSchema,
  organizationContentReviewRejectRouteSchema,
  organizationContentReviewsListResponseSchema,
  organizationContentReviewsListRouteSchema,
} from "../../../../assets/shared/schemas/organization-content-reviews";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { AdminContext } from "../../../_lib/db/context";
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
import { requireSystemPermission } from "./authorization";

export const SystemOrganizationContentReviewsList = openApiRoute(
  organizationContentReviewsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireSystemPermission(c, "organizations:content-review");
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
    const { db } = await requireSystemPermission(c, "organizations:content-review");
    return json({ review: await getContentReviewDetail(db, data.params.id) });
  },
);

export const SystemOrganizationContentReviewApprove = openApiRoute(
  organizationContentReviewApproveRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff: reviewer } = await requireSystemPermission(c, "organizations:content-review");
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
    const { db, staff: reviewer } = await requireSystemPermission(c, "organizations:content-review");
    const result = await rejectContentReview(db, data.params.id, reviewer, data.body.reviewerNote);

    if (result.staleLogoStagingR2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, result.staleLogoStagingR2Key, "assets"));
    }
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));

    return json(organizationContentReviewDecisionResponseSchema.parse({ review: result.review }));
  },
);
