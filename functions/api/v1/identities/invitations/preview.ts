import { identityInvitationPreviewResponseSchema } from "../../../../../assets/shared/schemas/identity";
import { identityInvitationPreviewRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-identities";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../_lib/request";
import { previewIdentityInvitation } from "../../../../_lib/services/identities";

export const IdentityInvitationPreviewPost = openApiRoute(
  identityInvitationPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const preview = await previewIdentityInvitation(requestDb(c), {
      token: data.body.token,
      signingSecret: requireInternalSecret(c.env),
    });
    return jsonPrivate(identityInvitationPreviewResponseSchema.parse({ success: true, ...preview }));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
