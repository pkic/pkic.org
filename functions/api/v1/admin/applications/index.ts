/**
 * GET /api/v1/admin/applications — list membership applications (PRD §4.2).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAdminApplications } from "../../../../_lib/services/admin-applications";
import {
  adminApplicationsListQuerySchema,
  adminApplicationsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");

  const url = new URL(c.req.raw.url);
  const parsed = adminApplicationsListQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;
  const offset = parsed.success ? (parsed.data.offset ?? 0) : 0;
  const stage = parsed.success ? parsed.data.stage : undefined;
  const status = parsed.success ? parsed.data.status : undefined;

  const { applications, total } = await listAdminApplications(requestDb(c), { limit, offset, stage, status });
  return json({ applications, page: { limit, offset, total, hasMore: offset + applications.length < total } });
}

export class ApplicationsList extends OpenAPIRoute {
  schema = adminApplicationsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
