/**
 * GET /api/v1/members/applications/form
 *
 * Returns the active public membership application form projection,
 * the same forms/form_fields tables event registration
 * forms already use, resolved by the well-known key 'membership-application'
 * (seeded in migrations/0035_membership_portal_governance.sql).
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { jsonNoStore } from "../../../../_lib/http";
import { getPublicMembershipApplicationForm } from "../../../../_lib/services/membership/application-form";
import { memberApplicationFormRouteSchema } from "../../../../../assets/shared/schemas/member-applications";

export async function onRequestGet(c: any): Promise<Response> {
  return jsonNoStore(await getPublicMembershipApplicationForm(c.env.DB));
}

export const MembersApplicationsFormGet = openApiRoute(memberApplicationFormRouteSchema, onRequestGet);
