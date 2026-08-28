import { groupPortalContextRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";
import { resolveUserSessionFromRequest } from "../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getPortalGroupContext } from "../../../../_lib/services/groups";

export const GroupPortalContextGet = openApiRoute(groupPortalContextRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const session = await resolveUserSessionFromRequest(db, c.req.raw, c.env);
  return json(
    await getPortalGroupContext(
      db,
      { userId: session.identity.id, ...(session.staff ? { admin: session.staff } : {}) },
      data.params.groupId,
    ),
  );
});
