import { identityRemoveRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-identities";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { removeRepresentation } from "../../../../_lib/services/identities/representation-removal";

export const UserIdentityDelete = openApiRoute(identityRemoveRouteSchema, async (c: AdminContext, data) =>
  jsonPrivate(await removeRepresentation(requestDb(c), c.req.raw, c.env, data.params.userId, data.params.identityId)),
);
