import { identityMutationResponseSchema } from "../../../../../../assets/shared/schemas/identity";
import { organizationIdentityUpdateRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-identities";
import { requireIdentityManagerActor } from "../../../../../_lib/auth/identity-access";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  transitionOrganizationIdentity,
  updateOrganizationIdentityProfile,
} from "../../../../../_lib/services/identities";

export const OrganizationIdentityPatch = openApiRoute(
  organizationIdentityUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityManagerActor(db, c.req.raw, c.env);
    const result = data.body.profile
      ? await updateOrganizationIdentityProfile(db, actor, {
          organizationId: data.params.organizationId,
          identityId: data.params.identityId,
          ...data.body.profile,
        })
      : await transitionOrganizationIdentity(db, actor, {
          organizationId: data.params.organizationId,
          identityId: data.params.identityId,
          transition: data.body.transition!,
        });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...result }));
  },
);
