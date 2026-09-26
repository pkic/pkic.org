import { identityMutationResponseSchema } from "../../../../../assets/shared/schemas/identity";
import { identityInvitationAcceptRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-identities";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../_lib/request";
import { acceptIdentityInvitationLink } from "../../../../_lib/services/identities";

export const IdentityInvitationAcceptPost = openApiRoute(
  identityInvitationAcceptRouteSchema,
  async (c: AdminContext, data) => {
    const accepted = await acceptIdentityInvitationLink(requestDb(c), {
      token: data.body.token,
      signingSecret: requireInternalSecret(c.env),
    });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...accepted }));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
