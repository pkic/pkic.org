import { identityMutationResponseSchema } from "../../../../../../assets/shared/schemas/identity";
import { currentUserIdentityAcceptRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-identities";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { acceptPendingIdentity } from "../../../../../_lib/services/identities";

export const CurrentUserIdentityPatch = openApiRoute(
  currentUserIdentityAcceptRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const result = await acceptPendingIdentity(db, {
      identityId: data.params.identityId,
      userId: actor.userId,
      sessionId: actor.sessionId,
    });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...result }));
  },
);
