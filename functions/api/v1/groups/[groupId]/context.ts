import { groupPortalContextRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";
import { resolvePortalSessionFromRequest } from "../../../../_lib/auth/portal";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getPortalGroupContext } from "../../../../_lib/services/groups";

export const GroupPortalContextGet = openApiRoute(groupPortalContextRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const session = await resolvePortalSessionFromRequest(db, c.req.raw, c.env);
  return json(
    await getPortalGroupContext(
      db,
      { userId: session.identity.id, ...(session.admin ? { admin: session.admin } : {}) },
      data.params.groupId,
    ),
  );
});
