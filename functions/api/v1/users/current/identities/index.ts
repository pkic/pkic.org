import {
  currentUserIdentitiesListRouteSchema,
  currentUserIdentityCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-identities";
import { identityMutationResponseSchema } from "../../../../../../assets/shared/schemas/identity";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { createCurrentUserIdentityFromDomain } from "../../../../../_lib/services/identities";
import { listOwnIdentitiesRequest } from "../../../../../_lib/services/identities/list-request";
import { commitOwnAffiliation } from "../../../../../_lib/services/identities/own-affiliation";

export const CurrentUserIdentitiesGet = openApiRoute(
  currentUserIdentitiesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    return jsonPrivate(await listOwnIdentitiesRequest(db, c.req.raw, c.env, data.query));
  },
);

export const CurrentUserIdentityPost = openApiRoute(
  currentUserIdentityCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    if ("contextToken" in data.body)
      return jsonPrivate(
        identityMutationResponseSchema.parse(await commitOwnAffiliation(db, c.req.raw, c.env, data.body.contextToken)),
        201,
      );
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const result = await createCurrentUserIdentityFromDomain(db, {
      userId: actor.userId,
      sessionId: actor.sessionId,
      organizationId: data.body.organizationId,
      emailId: data.body.emailId,
      jobTitle: data.body.jobTitle,
    });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...result }), 201);
  },
);
