/**
 * GET /api/v1/admin/organizations/content-reviews — the moderation queue.
 * Defaults to status=pending.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { listContentReviews } from "../../../../../_lib/services/organization-content-reviews";
import {
  contentReviewsListQuerySchema,
  contentReviewsListRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { parseListQuery } from "../../../../../_lib/openapi/list-query";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "organizations:content-review");

  const {
    status,
    limit = 50,
    offset = 0,
  } = parseListQuery(contentReviewsListQuerySchema, new URL(c.req.raw.url), ["status", "limit", "offset"]);
  const { reviews, total } = await listContentReviews(db, { status, limit, offset });

  return json({ reviews, page: buildPageInfo(limit, offset, total, reviews.length) });
}

export const OrganizationContentReviewsList = openApiRoute(contentReviewsListRouteSchema, onRequestGet);
