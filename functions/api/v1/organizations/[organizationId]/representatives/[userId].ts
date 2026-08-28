import { requireRepresentativeManagerActor } from "../../../../../_lib/auth/organization-representation-access";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  blockOrganizationRepresentative,
  resolveOrganizationMemberId,
  restoreOrganizationRepresentative,
  updateOrganizationRepresentativeProfile,
} from "../../../../../_lib/services/organization-representations";
import {
  organizationRepresentativeBlockRouteSchema,
  organizationRepresentativeRestoreRouteSchema,
  organizationRepresentativeUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-organization-representations";

export const OrganizationRepresentativeBlock = openApiRoute(
  organizationRepresentativeBlockRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
    const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
    await blockOrganizationRepresentative(db, actor, {
      memberId,
      userId: data.params.userId,
      reason: data.body.reason,
    });
    return json({ success: true });
  },
);

export const OrganizationRepresentativeUpdate = openApiRoute(
  organizationRepresentativeUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
    const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
    const representativeId = await updateOrganizationRepresentativeProfile(db, actor, {
      memberId,
      userId: data.params.userId,
      showOnOrganizationProfile: data.body.showOnOrganizationProfile,
    });
    return json({ success: true as const, representativeId });
  },
);

export const OrganizationRepresentativeRestore = openApiRoute(
  organizationRepresentativeRestoreRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
    const memberId = await resolveOrganizationMemberId(db, data.params.organizationId);
    await restoreOrganizationRepresentative(db, actor, {
      memberId,
      userId: data.params.userId,
      reason: data.body.reason,
    });
    return json({ success: true });
  },
);
