/**
 * POST /api/v1/admin/users/:userId/membership — grant an org-less individual
 * (H5/H6/H7) membership to an existing user. Org-tied categories are granted
 * via the canonical organization representative command instead, since that also
 * needs an organization to attach to.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { grantIndividualMembership } from "../../../../../_lib/services/organization-management";
import { userMembershipGrantRouteSchema } from "../../../../../../assets/shared/schemas/organization-management";
import { adminMemberMutationResponseSchema } from "../../../../../../assets/shared/schemas/admin-members";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const UserMembershipGrant = openApiRoute(userMembershipGrantRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const userId = data.params.userId;
  const body = data.body;
  const member = await grantIndividualMembership(requestDb(c), admin.id, userId, body.membershipCategory);

  return json(adminMemberMutationResponseSchema.parse({ member }), 201);
});
