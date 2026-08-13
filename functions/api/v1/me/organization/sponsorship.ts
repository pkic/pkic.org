/**
 * GET /api/v1/me/organization/sponsorship — view my organization's active
 * consortium sponsorship tier + start date.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { getMyOrganizationSponsorship } from "../../../../_lib/services/sponsorship";
import { myOrganizationSponsorshipGetRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeOrganizationSponsorshipGet = openApiRoute(
  myOrganizationSponsorshipGetRouteSchema,
  async (c: AdminContext) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const sponsorship = await getMyOrganizationSponsorship(db, member);
    return json(sponsorship);
  },
);
