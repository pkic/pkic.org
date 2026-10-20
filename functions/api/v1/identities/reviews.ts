import {
  affiliationReviewApproveResponseSchema,
  affiliationReviewGroupApproveRouteSchema,
  affiliationReviewGroupDecisionResponseSchema,
  affiliationReviewGroupDismissRouteSchema,
  affiliationReviewGroupGetRouteSchema,
  affiliationReviewGroupResponseSchema,
  affiliationReviewGroupsListResponseSchema,
  affiliationReviewGroupsListRouteSchema,
  affiliationReviewsListResponseSchema,
  affiliationReviewsListRouteSchema,
} from "../../../../assets/shared/schemas/affiliation-reviews";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { requirePermission } from "../../../_lib/auth/permissions";
import { approveAffiliationReviewGroup } from "../../../_lib/services/identities/affiliation-review-approval";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { dismissAffiliationReviewGroup } from "../../../_lib/services/identities/affiliation-review-decisions";
import {
  getAffiliationReviewGroup,
  listAffiliationReviewGroups,
  listAffiliationReviews,
} from "../../../_lib/services/identities/affiliation-reviews";

export const AffiliationReviewsList = openApiRoute(affiliationReviewsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "users:read");
  const { reviews, total } = await listAffiliationReviews(db, data.query);
  return json(
    affiliationReviewsListResponseSchema.parse({
      reviews,
      page: buildPageInfo(data.query.limit, data.query.offset, total, reviews.length),
    }),
  );
});

export const AffiliationReviewGroupsList = openApiRoute(
  affiliationReviewGroupsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "users:read");
    const { groups, total } = await listAffiliationReviewGroups(db, data.query);
    return json(
      affiliationReviewGroupsListResponseSchema.parse({
        groups,
        page: buildPageInfo(data.query.limit, data.query.offset, total, groups.length),
      }),
    );
  },
);

export const AffiliationReviewGroupGet = openApiRoute(
  affiliationReviewGroupGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffPermission(c, "users:read");
    return json(
      affiliationReviewGroupResponseSchema.parse({ group: await getAffiliationReviewGroup(db, data.params.groupKey) }),
    );
  },
);

export const AffiliationReviewGroupDismiss = openApiRoute(
  affiliationReviewGroupDismissRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "users:write");
    const decision = await dismissAffiliationReviewGroup(db, data.params.groupKey, staff);
    return json(affiliationReviewGroupDecisionResponseSchema.parse(decision));
  },
);

export const AffiliationReviewGroupApprove = openApiRoute(
  affiliationReviewGroupApproveRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "users:write");
    requirePermission(staff, "identities:activate");
    return json(
      affiliationReviewApproveResponseSchema.parse(
        await approveAffiliationReviewGroup(db, data.params.groupKey, data.body, staff),
      ),
    );
  },
);
