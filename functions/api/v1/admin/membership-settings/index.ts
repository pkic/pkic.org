/**
 * GET/PATCH /api/v1/admin/membership-settings.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { getMembershipSettings, updateMembershipSettings } from "../../../../_lib/services/membership-settings";
import {
  membershipSettingsGetRouteSchema,
  membershipSettingsUpdateRouteSchema,
  membershipSettingsUpdateSchema,
} from "../../../../../assets/shared/schemas/membership-settings";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

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

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:read");
  const settings = await getMembershipSettings(requestDb(c));
  return json(toResponse(settings));
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");
  const body = await parseJsonBody(c.req, membershipSettingsUpdateSchema);
  const settings = await updateMembershipSettings(requestDb(c), body, admin.id);
  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "membership_settings_updated",
    "membership_settings",
    "default",
    body,
  );
  return json(toResponse(settings));
}

export class MembershipSettingsGet extends OpenAPIRoute {
  schema = membershipSettingsGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class MembershipSettingsUpdate extends OpenAPIRoute {
  schema = membershipSettingsUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
