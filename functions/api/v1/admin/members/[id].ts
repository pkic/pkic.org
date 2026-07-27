/**
 * PATCH  /api/v1/admin/members/:id — edit a representative's category/status/visibility
 * DELETE /api/v1/admin/members/:id — remove a membership (detach the person from their org)
 *
 * Used from both the Organizations roster view and the Users detail
 * Membership panel — a single membership record has exactly one home.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { removeAdminMember, updateAdminMember } from "../../../../_lib/services/admin-organizations";
import {
  memberDeleteRouteSchema,
  memberUpdateRouteSchema,
  memberUpdateSchema,
} from "../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const id = c.req.param("id");
  const body = await parseJsonBody(c.req, memberUpdateSchema);
  const member = await updateAdminMember(requestDb(c), id, body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "member_updated", "member", id, body);

  return json({ member });
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const id = c.req.param("id");
  const removed = await removeAdminMember(requestDb(c), id);

  await writeAuditLog(requestDb(c), "admin", admin.id, "member_removed", "member", id, {
    userId: removed.user_id,
    organizationId: removed.organization_id,
  });

  return json({ success: true });
}

export class MemberUpdate extends OpenAPIRoute {
  schema = memberUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

export class MemberDelete extends OpenAPIRoute {
  schema = memberDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
