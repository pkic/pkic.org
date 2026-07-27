/**
 * GET /api/v1/admin/organizations — paginated, name-filtered organization
 * list for the admin Organizations section. Creating a brand-new
 * organization is still done via `POST /api/v1/admin/members` (the §6
 * Interim Admin Tool's org+representative creation flow) — this section
 * manages organizations after they exist, whether created there, via
 * migration, or via application approval (§4.7).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAdminOrganizations } from "../../../../_lib/services/admin-organizations";
import {
  organizationsListQuerySchema,
  organizationsListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "organizations:read");

  const url = new URL(c.req.raw.url);
  const parsed = organizationsListQuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  const q = parsed.success ? parsed.data.q : undefined;
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;
  const offset = parsed.success ? (parsed.data.offset ?? 0) : 0;

  const { organizations, total } = await listAdminOrganizations(requestDb(c), { limit, offset, q });
  return json({ organizations, page: { limit, offset, total, hasMore: offset + organizations.length < total } });
}

export class OrganizationsList extends OpenAPIRoute {
  schema = organizationsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
