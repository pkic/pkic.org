import {
  roleResponseEnvelopeSchema,
  rolesCreateRouteSchema,
  rolesListRouteSchema,
} from "../../../../../assets/shared/schemas/access-control";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { createRole, listRoles } from "../../../../_lib/services/access-control/roles";

export const RolesList = openApiRoute(rolesListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(await listRoles(requestDb(c), actor, data.query));
});

export const RolesCreate = openApiRoute(rolesCreateRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(roleResponseEnvelopeSchema.parse({ role: await createRole(requestDb(c), actor, data.body) }), 201);
});
