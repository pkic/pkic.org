import {
  userRoleResponseEnvelopeSchema,
  userRolesAssignRouteSchema,
  userRolesListRouteSchema,
} from "../../../../../../../assets/shared/schemas/access-control";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  assignUserRole,
  listUserRoleAssignments,
} from "../../../../../../_lib/services/access-control/user-role-assignments";

export const UserRolesList = openApiRoute(userRolesListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(await listUserRoleAssignments(requestDb(c), actor, data.params.userId, data.query));
});

export const UserRolesAssign = openApiRoute(userRolesAssignRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    userRoleResponseEnvelopeSchema.parse({
      role: await assignUserRole(requestDb(c), actor, data.params.userId, data.body),
    }),
    201,
  );
});
