import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getMyOrganizationProfile } from "../../../../_lib/services/organization-content";
import {
  organizationMemberProfileGetRouteSchema,
  organizationMemberProfileResponseSchema,
} from "../../../../../assets/shared/schemas/organization-self-service";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireOrganizationMember } from "../authorization";

export const OrganizationMemberProfileGet = openApiRoute(
  organizationMemberProfileGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMember(c, data.params.organizationId);
    return json(
      organizationMemberProfileResponseSchema.parse({
        organization: await getMyOrganizationProfile(db, member),
      }),
    );
  },
);
