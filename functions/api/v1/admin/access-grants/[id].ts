import { accessGrantRevokeRouteSchema } from "../../../../../assets/shared/schemas/access-control";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { revokeAccessGrant } from "../../../../_lib/services/access-control/access-grants";

export const AccessGrantsRevoke = openApiRoute(accessGrantRevokeRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await revokeAccessGrant(requestDb(c), actor, data.params.id);
  return json({ success: true });
});
