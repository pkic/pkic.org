import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { renderEmail, renderSubject } from "../../../../../../../_lib/email/render";
import { resolveTemplate } from "../../../../../../../_lib/email/templates";
import { loadEmailLayout } from "../../../../../../../_lib/email/partials";
import { registrationPageUrl, inviteDeclineUrl } from "../../../../../../../_lib/services/frontend-links";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import {
  computeAttendeeInviteDigest,
  signAttendeeInvitePreviewToken,
} from "../../../../../../../_lib/services/admin-invite-preview";
import { adminBulkAttendeeInvitesPreviewSchema } from "../../../../../../../../assets/shared/schemas/api";

const PREVIEW_TTL_SECONDS = 10 * 60;

export async function onRequestPost(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminBulkAttendeeInvitesPreviewSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const secret = requireInternalSecret(c.env);

  const firstInvite = body.invites[0];
  if (!firstInvite) {
    throw new AppError(400, "INVITE_PREVIEW_EMPTY", "At least one invite recipient is required");
  }

  const registrationUrl = registrationPageUrl(appBaseUrl, event, {
    invite: "preview-token",
    source: "invite",
  });
  const declineUrl = inviteDeclineUrl(appBaseUrl, event, "preview-token");

  const template = await resolveTemplate(c.env.DB, "attendee_invite");
  const layoutHtml = await loadEmailLayout(c.env.DB);
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
    layoutHtml,
    template.contentType as "markdown" | "html" | "text",
    appBaseUrl,
  );

  return json({
    success: true,
    previewToken: preview.token,
    previewExpiresAt: preview.expiresAt,
    inviteDigest: digest,
    recipientCount: body.invites.length,
    subject,
    html: rendered.html,
    text: rendered.text,
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
