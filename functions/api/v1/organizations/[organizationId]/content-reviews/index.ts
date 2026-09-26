import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import {
  organizationContentReviewCreateResponseSchema,
  organizationContentReviewCreateRouteSchema,
  organizationContentReviewsListResponseSchema,
  organizationContentReviewsListRouteSchema,
} from "../../../../../../assets/shared/schemas/organization-self-service";
import { getConfig } from "../../../../../_lib/config";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  listMyOrganizationReviews,
  processOrganizationContentReviewNotificationsBackground,
  submitOrgContentChange,
} from "../../../../../_lib/services/organization-content";
import { buildManagementLink } from "../../../../../_lib/services/management-links";
import { requireOrganizationMember, requireOrganizationMemberMutation } from "../../authorization";

export const OrganizationContentReviewsGet = openApiRoute(
  organizationContentReviewsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMember(c, data.params.organizationId);
    const result = await listMyOrganizationReviews(db, member, data.query);
    return json(
      organizationContentReviewsListResponseSchema.parse({
        reviews: result.reviews,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.reviews.length),
      }),
    );
  },
);

export const OrganizationContentReviewPost = openApiRoute(
  organizationContentReviewCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMemberMutation(c, data.params.organizationId);
    const { review } = await submitOrgContentChange(
      db,
      member,
      data.body,
      buildManagementLink(getConfig(c.env, c.req.raw).appBaseUrl, { kind: "organization-content-reviews" }),
    );
    c.executionCtx.waitUntil(processOrganizationContentReviewNotificationsBackground(db, c.env));
    return json(organizationContentReviewCreateResponseSchema.parse({ review }));
  },
);
