import { identityCorrectionRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-identities";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { correctRepresentation } from "../../../../_lib/services/identities/correction-request";

export const UserIdentityCorrectionPost = openApiRoute(identityCorrectionRouteSchema, async (c: AdminContext, data) =>
  jsonPrivate(
    await correctRepresentation(requestDb(c), c.req.raw, c.env, data.params.userId, data.params.identityId, data.body),
  ),
);
