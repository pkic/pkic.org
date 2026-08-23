import {
  accessGrantCreateResponseSchema,
  accessGrantsCreateRouteSchema,
  accessGrantsListRouteSchema,
} from "../../../../../assets/shared/schemas/access-control";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { createAccessGrant, listAccessGrants } from "../../../../_lib/services/access-control/access-grants";

export const AccessGrantsList = openApiRoute(accessGrantsListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(await listAccessGrants(requestDb(c), actor, data.query));
});

export const AccessGrantsCreate = openApiRoute(accessGrantsCreateRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    accessGrantCreateResponseSchema.parse({ grant: await createAccessGrant(requestDb(c), actor, data.body) }),
    201,
  );
});
