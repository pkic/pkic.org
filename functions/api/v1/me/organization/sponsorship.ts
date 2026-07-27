/**
 * GET /api/v1/me/organization/sponsorship — view my organization's active
 * consortium sponsorship tier + start date (PRD §4.13).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { getMyOrganizationSponsorship } from "../../../../_lib/services/sponsorship";
import { myOrganizationSponsorshipGetRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const sponsorship = await getMyOrganizationSponsorship(db, member);
  return json(sponsorship);
}

export class MeOrganizationSponsorshipGet extends OpenAPIRoute {
  schema = myOrganizationSponsorshipGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
