import {
  organizationActiveSponsorshipGetRouteSchema,
  organizationActiveSponsorshipResponseSchema,
} from "../../../../../../assets/shared/schemas/organization-self-service";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getMyOrganizationSponsorship } from "../../../../../_lib/services/sponsorship";
import { requireOrganizationMember } from "../../authorization";

export const OrganizationActiveSponsorshipGet = openApiRoute(
  organizationActiveSponsorshipGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMember(c, data.params.organizationId);
    return json(
      organizationActiveSponsorshipResponseSchema.parse({
        sponsorship: await getMyOrganizationSponsorship(db, member),
      }),
    );
  },
);
