import {
  roleAssignmentsListRouteSchema,
  roleDeleteRouteSchema,
  roleResponseEnvelopeSchema,
  rolesCreateRouteSchema,
  rolesListRouteSchema,
} from "../../../../../assets/shared/schemas/access-control";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { createRole, deleteRole, listRoles } from "../../../../_lib/services/access-control/roles";
import { listActiveRoleAssignmentHolders } from "../../../../_lib/services/access-control/user-role-assignments";
import { requireSystemAnyPermission, requireSystemPermission } from "../authorization";

export const SystemRolesList = openApiRoute(rolesListRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(await listRoles(db, staff, data.query));
});

export const SystemRolesCreate = openApiRoute(rolesCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemPermission(c, "access:grant");
  return json(roleResponseEnvelopeSchema.parse({ role: await createRole(db, staff, data.body) }), 201);
});

export const SystemRolesDelete = openApiRoute(roleDeleteRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemPermission(c, "access:revoke");
  await deleteRole(db, staff, data.params.id);
  return json({ success: true });
});

export const SystemRoleAssignmentsList = openApiRoute(roleAssignmentsListRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireSystemAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(await listActiveRoleAssignmentHolders(db, staff, data.params.id, data.query));
});
