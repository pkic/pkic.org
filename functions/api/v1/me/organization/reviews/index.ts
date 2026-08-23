/**
 * GET /api/v1/me/organization/reviews — status of my organization's
 * pending/past content submissions.
 */
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { listMyOrganizationReviews } from "../../../../../_lib/services/organization-content";
import {
  myOrganizationReviewsListResponseSchema,
  myOrganizationReviewsListRouteSchema,
} from "../../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

export const MeOrganizationReviewsGet = openApiRoute(
  myOrganizationReviewsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const result = await listMyOrganizationReviews(db, member, data.query);
    return json(
      myOrganizationReviewsListResponseSchema.parse({
        reviews: result.reviews,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.reviews.length),
      }),
    );
  },
);
