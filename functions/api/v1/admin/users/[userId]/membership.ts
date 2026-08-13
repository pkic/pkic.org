/**
 * POST /api/v1/admin/users/:userId/membership — grant an org-less individual
 * (H5/H6/H7) membership to an existing user. Org-tied categories are granted
 * via POST /api/v1/admin/organizations/:id/members instead, since that also
 * needs an organization to attach to.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { grantIndividualMembership } from "../../../../../_lib/services/admin-organizations";
import { userMembershipGrantRouteSchema } from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const UserMembershipGrant = openApiRoute(userMembershipGrantRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const userId = data.params.userId;
  const body = data.body;
  const member = await grantIndividualMembership(requestDb(c), userId, body.membershipCategory);

  await writeAuditLog(requestDb(c), "admin", admin.id, "member_created", "member", member.id, {
    userId,
    membershipCategory: body.membershipCategory,
  });

  return json({ member }, 201);
});
