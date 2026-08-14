/**
 * GET /api/v1/members/applications/form
 *
 * Returns the active, staff-editable membership application form definition,
 * the same forms/form_fields tables event registration
 * forms already use, resolved by the well-known key 'membership-application'
 * (seeded in migrations/0034_applications_sponsorships_working_groups.sql).
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { getGlobalFormByKey } from "../../../../_lib/services/forms";
import { memberApplicationFormRouteSchema } from "../../../../../assets/shared/schemas/member-applications";

const APPLICATION_FORM_KEY = "membership-application";

export async function onRequestGet(c: any): Promise<Response> {
  const db = c.env.DB;
  const form = await getGlobalFormByKey(db, APPLICATION_FORM_KEY);
  const response = json({ form });
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
}

export const MembersApplicationsFormGet = openApiRoute(memberApplicationFormRouteSchema, onRequestGet);
