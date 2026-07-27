/**
 * GET /api/v1/admin/organizations/content-reviews — the moderation queue
 * (PRD §4.11). Defaults to status=pending.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { listContentReviews } from "../../../../../_lib/services/organization-content-reviews";
import {
  contentReviewsListQuerySchema,
  contentReviewsListRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "organizations:content-review");

  const url = new URL(c.req.raw.url);
  const parsed = contentReviewsListQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  const status = parsed.success ? parsed.data.status : undefined;
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;
  const offset = parsed.success ? (parsed.data.offset ?? 0) : 0;
  const { reviews, total } = await listContentReviews(db, { status, limit, offset });

  return json({ reviews, page: { limit, offset, total, hasMore: offset + reviews.length < total } });
}

export class OrganizationContentReviewsList extends OpenAPIRoute {
  schema = contentReviewsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
