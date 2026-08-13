/**
 * POST /api/v1/admin/consortium/meetings/:meetingId/resend — trigger the
 * annual bulk resend for the consortium meeting series. Smart-
 * routed: active members with a saved, still-active preference get only
 * that variant; everyone else gets all active variants.
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { planAnnualResend } from "../../../../../../_lib/services/meeting-calendar";
import { queueEmail, processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { consortiumMeetingResendRouteSchema } from "../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const ConsortiumMeetingResendPost = openApiRoute(
  consortiumMeetingResendRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

    const plan = await planAnnualResend(db, data.params.meetingId, { scopeType: "consortium" });

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
  },
);
