/**
 * GET /api/v1/admin/roles/:id/assignments — reverse lookup: every active
 * holder of a role, across all contexts.
 *
 * Every other role-assignment screen in the admin portal starts from a user
 * ("what roles does this person hold?" — GET /api/v1/admin/users/:userId/roles).
 * The Chairs tab
 * needs the reverse: "who currently holds role-forum_chair?" — with no user
 * already picked. This is that lookup, generic over any role id so it also
 * backs the WG chair/vice-chair display without a second endpoint.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { listActiveRoleAssignmentHolders } from "../../../../../_lib/services/access-control/user-role-assignments";
import { roleAssignmentsListRouteSchema } from "../../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const RoleAssignmentsList = openApiRoute(roleAssignmentsListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(await listActiveRoleAssignmentHolders(requestDb(c), admin, data.params.id, data.query));
});
