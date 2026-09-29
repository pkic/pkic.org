import {
  currentUserIdentitiesListRouteSchema,
  currentUserIdentityCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-identities";
import { identityMutationResponseSchema } from "../../../../../../assets/shared/schemas/identity";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { createCurrentUserIdentityFromDomain, listUserIdentities } from "../../../../../_lib/services/identities";

export const CurrentUserIdentitiesGet = openApiRoute(
  currentUserIdentitiesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    return jsonPrivate(await listUserIdentities(db, actor.userId, data.query));
  },
);

export const CurrentUserIdentityPost = openApiRoute(
  currentUserIdentityCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const result = await createCurrentUserIdentityFromDomain(db, {
      userId: actor.userId,
      sessionId: actor.sessionId,
      organizationId: data.body.organizationId,
      emailId: data.body.emailId,
    });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...result }), 201);
  },
);
