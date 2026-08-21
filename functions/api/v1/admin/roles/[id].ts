import { roleDeleteRouteSchema } from "../../../../../assets/shared/schemas/access-control";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { deleteRole } from "../../../../_lib/services/access-control/roles";

export const RolesDelete = openApiRoute(roleDeleteRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await deleteRole(requestDb(c), actor, data.params.id);
  return json({ success: true });
});
