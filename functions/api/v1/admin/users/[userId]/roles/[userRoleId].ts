import {
  userRoleRevokeRouteSchema,
  userRoleUpdateExpiryRouteSchema,
} from "../../../../../../../assets/shared/schemas/access-control";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  revokeUserRoleAssignment,
  updateUserRoleAssignmentExpiry,
} from "../../../../../../_lib/services/access-control/user-role-assignments";

export const UserRolesRevoke = openApiRoute(userRoleRevokeRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await revokeUserRoleAssignment(requestDb(c), actor, data.params.userId, data.params.userRoleId);
  return json({ success: true });
});

export const UserRolesUpdateExpiry = openApiRoute(userRoleUpdateExpiryRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json({
    role: await updateUserRoleAssignmentExpiry(
      requestDb(c),
      actor,
      data.params.userId,
      data.params.userRoleId,
      data.body,
    ),
  });
});
