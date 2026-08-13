/**
 * PATCH  /api/v1/admin/members/:id — edit a representative's category/status/visibility
 * DELETE /api/v1/admin/members/:id — remove a membership (detach the person from their org)
 *
 * Used from both the Organizations roster view and the Users detail
 * Membership panel — a single membership record has exactly one home.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { removeAdminMember, updateAdminMember } from "../../../../_lib/services/admin-organizations";
import {
  memberDeleteRouteSchema,
  memberUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export const MemberUpdate = openApiRoute(memberUpdateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const id = data.params.id;
  const body = data.body;
  const member = await updateAdminMember(requestDb(c), id, body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "member_updated", "member", id, body);

  return json({ member });
});

export const MemberDelete = openApiRoute(memberDeleteRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const id = data.params.id;
  const removed = await removeAdminMember(requestDb(c), id);

  await writeAuditLog(requestDb(c), "admin", admin.id, "member_removed", "member", id, {
    userId: removed.user_id,
    organizationId: removed.organization_id,
  });

  return json({ success: true });
});
