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
import { getGlobalFormByKey } from "../../../../_lib/services/forms";
import { requireMembershipApplicationPolicyFields } from "../../../../_lib/services/membership/application-form";
import { listMembershipCategories } from "../../../../_lib/services/membership/categories";
import { MEMBERSHIP_APPLICATION_FORM_KEY } from "../../../../../assets/shared/schemas/membership-application-form";
import {
  memberApplicationFormResponseSchema,
  memberApplicationFormRouteSchema,
} from "../../../../../assets/shared/schemas/member-applications";

export async function onRequestGet(c: any): Promise<Response> {
  const db = c.env.DB;
  const [form, categories] = await Promise.all([
    getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY),
    listMembershipCategories(db),
  ]);
  if (form) requireMembershipApplicationPolicyFields(form.fields);
  return jsonNoStore(memberApplicationFormResponseSchema.parse({ form, categories }));
}

export const MembersApplicationsFormGet = openApiRoute(memberApplicationFormRouteSchema, onRequestGet);
