/**
 * GET/PATCH /api/v1/admin/membership-settings.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { getMembershipSettings, updateMembershipSettings } from "../../../../_lib/services/membership-settings";
import {
  membershipSettingsGetRouteSchema,
  membershipSettingsUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/membership-settings";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

function toResponse(row: Awaited<ReturnType<typeof getMembershipSettings>>) {
  return {
    consultationWindowDays: row.consultation_window_days,
    ecReviewWindowDays: row.ec_review_window_days,
    onHoldResponseDeadlineDays: row.on_hold_response_deadline_days,
    consultationEmailRecipients: row.consultation_email_recipients,
    ecEmailRecipients: row.ec_email_recipients,
    ccApplicantEmails: row.cc_applicant_emails,
    autoReminderOnHolds: row.auto_reminder_on_holds === 1,
    forumVoteMinEndorsers: row.forum_vote_min_endorsers,
    updatedAt: row.updated_at,
  };
}

export const MembershipSettingsGet = openApiRoute(membershipSettingsGetRouteSchema, async (c: AdminContext, _data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");
  const settings = await getMembershipSettings(requestDb(c));
  return json(toResponse(settings));
});

export const MembershipSettingsUpdate = openApiRoute(
  membershipSettingsUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "membership:write");
    const body = data.body;
    const settings = await updateMembershipSettings(requestDb(c), body, admin.id);
    return json(toResponse(settings));
  },
);
