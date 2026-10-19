import { identityMutationResponseSchema } from "../../../../../../assets/shared/schemas/identity";
import { currentUserIdentityUpdateRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-identities";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { acceptPendingIdentity, endOwnIdentity } from "../../../../../_lib/services/identities";

export const CurrentUserIdentityPatch = openApiRoute(
  currentUserIdentityUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const { transition } = data.body;
    const input = { identityId: data.params.identityId, userId: actor.userId, sessionId: actor.sessionId };
    const result =
      transition.state === "active"
        ? await acceptPendingIdentity(db, input)
        : await endOwnIdentity(db, { ...input, endedAt: transition.endedAt });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...result }));
  },
);
