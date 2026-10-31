import { identityInvitationManagementRouteSchema } from "../../../../../../assets/shared/schemas/identity-invitation-management";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { manageIdentityInvitation } from "../../../../../_lib/services/identities/invitation-management";

export const OrganizationIdentityInvitationPost = openApiRoute(
  identityInvitationManagementRouteSchema,
  async (c: AdminContext, data) =>
    jsonPrivate(
      await manageIdentityInvitation(
        requestDb(c),
        c.req.raw,
        c.env,
        data.params.organizationId,
        data.params.identityId,
        data.body,
      ),
    ),
);
