import {
  userRoleResponseEnvelopeSchema,
  userRoleRevokeRouteSchema,
  userRolesAssignRouteSchema,
  userRolesListRouteSchema,
  userRoleUpdateExpiryRouteSchema,
} from "../../../../../assets/shared/schemas/access-control";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  assignUserRole,
  listUserRoleAssignments,
  revokeUserRoleAssignment,
  updateUserRoleAssignmentExpiry,
} from "../../../../_lib/services/access-control/user-role-assignments";
import { requireStaffAnyPermission, requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const UserRolesList = openApiRoute(userRolesListRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(await listUserRoleAssignments(db, staff, data.params.userId, data.query));
});

export const UserRolesAssign = openApiRoute(userRolesAssignRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "access:grant");
  return json(
    userRoleResponseEnvelopeSchema.parse({
      role: await assignUserRole(db, staff, data.params.userId, data.body),
    }),
    201,
  );
});

export const UserRolesRevoke = openApiRoute(userRoleRevokeRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "access:revoke");
  await revokeUserRoleAssignment(db, staff, data.params.userId, data.params.userRoleId);
  return json({ success: true });
});

export const UserRolesUpdateExpiry = openApiRoute(userRoleUpdateExpiryRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "access:grant");
  return json(
    userRoleResponseEnvelopeSchema.parse({
      role: await updateUserRoleAssignmentExpiry(db, staff, data.params.userId, data.params.userRoleId, data.body),
    }),
  );
});
