import { identitiesListRouteSchema } from "../../../../assets/shared/schemas/route-contracts-identities";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { jsonPrivate } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listIdentityRecordsRequest } from "../../../_lib/services/identities/list-request";

export const IdentitiesGet = openApiRoute(identitiesListRouteSchema, async (c: AdminContext, data) =>
  jsonPrivate(await listIdentityRecordsRequest(requestDb(c), c.req.raw, c.env, data.query)),
);
