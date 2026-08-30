import { requireRepresentativeManagerActor } from "../../../../_lib/auth/organization-representation-access";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  associateOrganizationRepresentative,
  associateOrganizationRepresentativeByEmail,
  listOrganizationRepresentatives,
  requireOrganizationRepresentativeManagement,
  resolveOrganizationMemberId,
} from "../../../../_lib/services/organization-representations";
import {
  organizationRepresentativeAssociateRouteSchema,
  organizationRepresentativesListRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-organization-representations";
import { organizationRepresentativesListResponseSchema } from "../../../../../assets/shared/schemas/organization-representation";
import { requireOrganizationStaffPermission } from "../authorization";
import { requireOrganizationMemberMutation } from "../authorization";
import { addCoworker } from "../../../../_lib/services/member-organization";

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
    let representativeId: string;
    if (data.body.kind === "email") {
      const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
      if (actor.staffAuthorized) {
        const { staff } = await requireOrganizationStaffPermission(c, "membership:write");
        const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
        representativeId = await associateOrganizationRepresentativeByEmail(db, staff, {
          memberId,
          email: data.body.email,
          name: data.body.name,
          jobTitle: data.body.jobTitle,
          biography: data.body.biography,
          links: data.body.links,
          showOnOrganizationProfile: data.body.showOnOrganizationProfile,
        });
      } else {
        const { db: guardedDb, member } = await requireOrganizationMemberMutation(c, data.params.organizationId);
        const result = await addCoworker(guardedDb, member, {
          email: data.body.email,
          name: data.body.name,
        });
        representativeId = result.representativeId;
      }
    } else {
      const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
      const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
      const mutationDb = actor.staffAuthorized
        ? db
        : (await requireOrganizationMemberMutation(c, data.params.organizationId)).db;
      representativeId = await associateOrganizationRepresentative(mutationDb, actor, {
        memberId,
        userId: data.body.userId,
        emailId: data.body.emailId,
        jobTitle: data.body.jobTitle,
        biography: data.body.biography,
        links: data.body.links,
        showOnOrganizationProfile: data.body.showOnOrganizationProfile,
      });
    }
    return json({ success: true as const, representativeId }, 201);
  },
);
