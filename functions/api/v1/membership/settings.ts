import {
  membershipSettingsGetRouteSchema,
  membershipSettingsSchema,
  membershipSettingsUpdateRouteSchema,
} from "../../../../assets/shared/schemas/membership-settings";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { getMembershipSettings, updateMembershipSettings } from "../../../_lib/services/membership-settings";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";

function toResponse(row: Awaited<ReturnType<typeof getMembershipSettings>>) {
  return membershipSettingsSchema.parse({
    consultationWindowDays: row.consultation_window_days,
    ecReviewWindowDays: row.ec_review_window_days,
    onHoldResponseDeadlineDays: row.on_hold_response_deadline_days,
    consultationEmailRecipients: row.consultation_email_recipients,
    ecEmailRecipients: row.ec_email_recipients,
    ccApplicantEmails: row.cc_applicant_emails,
    autoReminderOnHolds: row.auto_reminder_on_holds === 1,
    revision: row.revision,
    updatedAt: row.updated_at,
  });
}

export const MembershipSettingsGet = openApiRoute(membershipSettingsGetRouteSchema, async (c: AdminContext) => {
  const { db } = await requireStaffPermission(c, "membership:read");
  return json(toResponse(await getMembershipSettings(db)));
});

export const MembershipSettingsUpdate = openApiRoute(
  membershipSettingsUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:write");
    return json(toResponse(await updateMembershipSettings(db, data.body, staff)));
  },
);
