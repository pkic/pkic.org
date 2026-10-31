import { identityAffiliationPreviewRouteSchema } from "../../../../../../assets/shared/schemas/identity-affiliation";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { previewOwnAffiliation } from "../../../../../_lib/services/identities/own-affiliation";

export const CurrentUserIdentityPreviewPost = openApiRoute(
  identityAffiliationPreviewRouteSchema,
  async (c: AdminContext, data) => jsonPrivate(await previewOwnAffiliation(requestDb(c), c.req.raw, c.env, data.body)),
);
