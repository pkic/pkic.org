/**
 * POST /api/v1/admin/working-groups/:id/meetings/:meetingId/resend —
 * trigger the annual bulk resend for a working group meeting series.
 * Smart-routed: members with a saved, still-active preference
 * get only that variant; everyone else gets all active variants.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { getWorkingGroupBySlugOrId } from "../../../../../../../_lib/services/working-groups";
import { planAnnualResend } from "../../../../../../../_lib/services/meeting-calendar";
import { queueEmail, processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { wgMeetingResendRouteSchema } from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const wg = await getWorkingGroupBySlugOrId(db, c.req.param("id"));
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const plan = await planAnnualResend(db, c.req.param("meetingId"), {
    scopeType: "working_group",
    workingGroupId: wg.id,
  });

  for (const recipient of plan.recipients) {
    const outboxId = await queueEmail(db, {
      templateKey: "calendar-invite-resend",
      recipientEmail: recipient.email,
      recipientUserId: recipient.userId,
      messageType: "transactional",
      subject: `Updated calendar invite: ${plan.seriesName}`,
      data: { memberName: recipient.name, seriesName: plan.seriesName, hasPreference: recipient.hasPreference },
      attachments: recipient.icsAttachments,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json({ success: true, seriesName: plan.seriesName, queuedRecipients: plan.recipients.length });
}

export class WgMeetingResendPost extends OpenAPIRoute {
  schema = wgMeetingResendRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
