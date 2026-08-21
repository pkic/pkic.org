/**
 * GET /api/v1/admin/organizations/content-reviews — the moderation queue.
 * Defaults to status=pending.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { listContentReviews } from "../../../../../_lib/services/organization-content";
import { contentReviewsListRouteSchema } from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

export const OrganizationContentReviewsList = openApiRoute(
  contentReviewsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "organizations:content-review");

    const { status, q, sort, limit, offset } = data.query;
    const { reviews, total } = await listContentReviews(db, { status, q, sort, limit, offset });

    return json({ reviews, page: buildPageInfo(limit, offset, total, reviews.length) });
  },
);
