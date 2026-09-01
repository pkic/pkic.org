import {
  identitiesListResponseSchema,
  identityMutationResponseSchema,
} from "../../../../../../assets/shared/schemas/identity";
import {
  organizationIdentitiesListRouteSchema,
  organizationIdentityCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-identities";
import { requireIdentityManagerActor } from "../../../../../_lib/auth/identity-access";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  createOrganizationIdentity,
  createOrganizationIdentityByEmail,
  listOrganizationIdentities,
  requireOrganizationIdentityManagement,
  resolveOrganizationMemberId,
} from "../../../../../_lib/services/identities";

export const OrganizationIdentitiesGet = openApiRoute(
  organizationIdentitiesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityManagerActor(db, c.req.raw, c.env);
    const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
    await requireOrganizationIdentityManagement(db, {
      memberId,
      actorUserId: actor.userId,
      databaseUserId: actor.databaseUserId,
      staffAuthorized: actor.staffAuthorized,
    });
    return jsonPrivate(
      identitiesListResponseSchema.parse(await listOrganizationIdentities(db, data.params.organizationId, data.query)),
    );
  },
);

export const OrganizationIdentityPost = openApiRoute(
  organizationIdentityCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityManagerActor(db, c.req.raw, c.env);
    const result =
      data.body.userReference === "existing_user"
        ? await createOrganizationIdentity(db, actor, {
            organizationId: data.params.organizationId,
            userId: data.body.userId,
            emailId: data.body.emailId,
            jobTitle: data.body.jobTitle,
            biography: data.body.biography,
            links: data.body.links,
            showOnOrganizationProfile: data.body.showOnOrganizationProfile ?? true,
            activation: data.body.activation,
          })
        : await createOrganizationIdentityByEmail(db, actor, {
            organizationId: data.params.organizationId,
            email: data.body.email,
            name: data.body.name,
            jobTitle: data.body.jobTitle,
            biography: data.body.biography,
            links: data.body.links,
            showOnOrganizationProfile: data.body.showOnOrganizationProfile,
            activation: data.body.activation,
          });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...result }), 201);
  },
);
