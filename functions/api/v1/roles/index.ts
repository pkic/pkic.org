import {
  roleAssignmentsListRouteSchema,
  roleDeleteRouteSchema,
  roleGetRouteSchema,
  roleResponseEnvelopeSchema,
  roleUpdateRouteSchema,
  rolesCreateRouteSchema,
  rolesListRouteSchema,
} from "../../../../assets/shared/schemas/access-control";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { createRole, deleteRole, getRole, listRoles, updateRole } from "../../../_lib/services/access-control/roles";
import { listActiveRoleAssignmentHolders } from "../../../_lib/services/access-control/user-role-assignments";
import { requireStaffAnyPermission, requireStaffPermission } from "../../../_lib/auth/staff-permissions";

export const RolesList = openApiRoute(rolesListRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(await listRoles(db, staff, data.query));
});

export const RoleCreate = openApiRoute(rolesCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "access:grant");
  return json(roleResponseEnvelopeSchema.parse({ role: await createRole(db, staff, data.body) }), 201);
});

export const RoleGet = openApiRoute(roleGetRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(roleResponseEnvelopeSchema.parse({ role: await getRole(db, staff, data.params.id) }));
});

export const RoleUpdate = openApiRoute(roleUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "access:grant");
  return json(roleResponseEnvelopeSchema.parse({ role: await updateRole(db, staff, data.params.id, data.body) }));
});

export const RoleDelete = openApiRoute(roleDeleteRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "access:revoke");
  await deleteRole(db, staff, data.params.id);
  return json({ success: true });
});

export const RoleAssignmentsList = openApiRoute(roleAssignmentsListRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(await listActiveRoleAssignmentHolders(db, staff, data.params.id, data.query));
});
