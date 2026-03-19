import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { createInvite } from "../../../../../../../_lib/services/invites";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../../../../_lib/email/outbox";
import { registrationPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import {
  computeAttendeeInviteDigest,
  verifyAttendeeInvitePreviewToken,
} from "../../../../../../../_lib/services/admin-invite-preview";
import type { PagesContext } from "../../../../../../../_lib/types";
import { adminBulkAttendeeInvitesSchema } from "../../../../../../../../assets/shared/schemas/api";

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminBulkAttendeeInvitesSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const secret = requireInternalSecret(context.env);

  const inviteDigest = await computeAttendeeInviteDigest(body.invites);
  const previewValidation = await verifyAttendeeInvitePreviewToken({
    secret,
    token: body.previewToken,
    eventId: event.id,
    adminId: admin.id,
    inviteDigest,
  });

  if (!previewValidation.ok) {
    if (previewValidation.reason === "expired") {
      throw new AppError(409, "INVITE_PREVIEW_EXPIRED", "Invite preview expired. Render a fresh preview before sending.");
    }
    if (previewValidation.reason === "mismatch") {
      throw new AppError(409, "INVITE_PREVIEW_STALE", "Invite list changed after preview. Render preview again before sending.");
    }
    throw new AppError(400, "INVITE_PREVIEW_INVALID", "Invalid invite preview token. Render preview before sending.");
  }

  const created: Array<{ email: string; inviteToken: string }> = [];
  for (const item of body.invites) {
    const { invite, token } = await createInvite(context.env.DB, {
      eventId: event.id,
      inviteeEmail: item.email,
      inviteeFirstName: item.firstName,
      inviteeLastName: item.lastName,
      inviteType: "attendee",
      sourceType: item.sourceType,
      ttlHours: 24 * 14,
    });

    const registrationUrl = registrationPageUrl(appBaseUrl, event, {
      invite: token,
      source: "invite",
    });
    const declineUrl = inviteDeclineUrl(appBaseUrl, event, token);
    const outboxId = await queueEmail(context.env.DB, {
      eventId: event.id,
      templateKey: "attendee_invite",
      recipientEmail: invite.invitee_email,
      messageType: "transactional",
      subject: `Invitation: ${event.name}`,
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        registrationUrl,
        declineUrl,
      },
    });

    context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
    created.push({ email: invite.invitee_email, inviteToken: token });
  }

  return json({ success: true, created });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}
