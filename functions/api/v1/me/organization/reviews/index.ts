/**
 * GET /api/v1/me/organization/reviews — status of my organization's
 * pending/past content submissions.
 */
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { listMyOrganizationReviews } from "../../../../../_lib/services/organization-content-reviews";
import { myOrganizationReviewsListRouteSchema } from "../../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const MeOrganizationReviewsGet = openApiRoute(myOrganizationReviewsListRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const reviews = await listMyOrganizationReviews(db, member);
  return json({ reviews });
});
