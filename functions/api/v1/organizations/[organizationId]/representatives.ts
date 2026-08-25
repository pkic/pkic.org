import { requireRepresentativeManagerActor } from "../../../../_lib/auth/organization-representation-access";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  associateOrganizationRepresentative,
  listOrganizationRepresentatives,
  requireOrganizationRepresentativeManagement,
  resolveOrganizationMemberId,
} from "../../../../_lib/services/organization-representations";
import {
  organizationRepresentativeAssociateRouteSchema,
  organizationRepresentativesListRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-organization-representations";
import { organizationRepresentativesListResponseSchema } from "../../../../../assets/shared/schemas/organization-representation";

export const OrganizationRepresentativesList = openApiRoute(
  organizationRepresentativesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
    const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
    await requireOrganizationRepresentativeManagement(db, {
      memberId,
      actorUserId: actor.userId,
      databaseUserId: actor.databaseUserId,
      staffAuthorized: actor.staffAuthorized,
    });
    return json(
      organizationRepresentativesListResponseSchema.parse(
        await listOrganizationRepresentatives(db, data.params.organizationId, data.query),
      ),
    );
  },
);

export const OrganizationRepresentativeAssociate = openApiRoute(
  organizationRepresentativeAssociateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
    const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
    const representativeId = await associateOrganizationRepresentative(db, actor, {
      memberId,
      userId: data.body.userId,
      showOnOrganizationProfile: data.body.showOnOrganizationProfile,
    });
    return json({ success: true as const, representativeId }, 201);
  },
);
