/**
 * GET /api/v1/admin/organizations/content-reviews/:id — review detail with
 * a side-by-side diff of current live content vs. proposed changes.
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { getContentReviewDetail } from "../../../../../../_lib/services/organization-content-reviews";
import { contentReviewGetRouteSchema } from "../../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const OrganizationContentReviewGet = openApiRoute(contentReviewGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "organizations:content-review");

  const review = await getContentReviewDetail(db, data.params.id);
  return json({ review });
});
