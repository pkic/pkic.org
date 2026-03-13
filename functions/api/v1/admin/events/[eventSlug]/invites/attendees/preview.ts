import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { renderEmail, renderSubject } from "../../../../../../../_lib/email/render";
import { resolveTemplate } from "../../../../../../../_lib/email/templates";
import { registrationPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import {
  computeAttendeeInviteDigest,
  signAttendeeInvitePreviewToken,
} from "../../../../../../../_lib/services/admin-invite-preview";
import type { PagesContext } from "../../../../../../../_lib/types";
import { adminBulkAttendeeInvitesPreviewSchema } from "../../../../../../../../shared/schemas/api";

const PREVIEW_TTL_SECONDS = 10 * 60;

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminBulkAttendeeInvitesPreviewSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(context.env);
  const secret = requireInternalSecret(context.env);

  const firstInvite = body.invites[0];
  if (!firstInvite) {
    throw new AppError(400, "INVITE_PREVIEW_EMPTY", "At least one invite recipient is required");
  }

  const registrationUrl = registrationPageUrl(appBaseUrl, event, {
    invite: "preview-token",
    source: "invite",
  });
  const declineUrl = inviteDeclineUrl(appBaseUrl, event, "preview-token");

  const template = await resolveTemplate(context.env.DB, "attendee_invite");
  const digest = await computeAttendeeInviteDigest(body.invites);
  const preview = await signAttendeeInvitePreviewToken({
    secret,
    eventId: event.id,
    adminId: admin.id,
    inviteDigest: digest,
    ttlSeconds: PREVIEW_TTL_SECONDS,
  });

  const data = {
    ...buildEventEmailVariables(event, appBaseUrl),
    firstName: firstInvite.firstName ?? "Attendee",
    lastName: firstInvite.lastName ?? "",
    registrationUrl,
    declineUrl,
    inviteCount: body.invites.length,
  };

  const subject = renderSubject(template.subjectTemplate, `Invitation: ${event.name}`, data);
  const rendered = await renderEmail(
    template.content,
    data,
    null,
    template.contentType as "markdown" | "html" | "text",
    appBaseUrl,
  );

  return json({
    success: true,
    previewToken: preview.token,
    previewExpiresAt: preview.expiresAt,
    recipientCount: body.invites.length,
    subject,
    html: rendered.html,
    text: rendered.text,
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}
