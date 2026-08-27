import { AppError } from "../errors";
import { renderEmail, renderSubject } from "../email/render";
import { loadEmailRenderBundle } from "../email/partials";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl } from "./frontend-links";
import {
  computeAdminInviteDigest,
  signAdminInvitePreviewToken,
  type AdminInvitePreviewInput,
  type AdminInviteType,
} from "./admin-invite-preview";
import type { EmailContentType } from "../../../assets/shared/schemas/admin-email-templates";
import type { DatabaseLike } from "../types";
import { resolveEventInviteExpiry } from "../invite-validity";

const PREVIEW_TTL_SECONDS = 10 * 60;

export async function buildAdminInvitePreview(params: {
  db: DatabaseLike;
  event: EventRecord;
  appBaseUrl: string;
  signingSecret: string;
  adminId: string;
  inviteType: AdminInviteType;
  invites: AdminInvitePreviewInput[];
  expiresAt?: string;
}): Promise<{
  previewToken: string;
  previewExpiresAt: string;
  inviteDigest: string;
  inviteExpiresAt: string;
  recipientCount: number;
  subject: string;
  html: string;
  text: string;
}> {
  const firstInvite = params.invites[0];
  if (!firstInvite) {
    throw new AppError(400, "INVITE_PREVIEW_EMPTY", "At least one invite recipient is required");
  }

  const templateKey = params.inviteType === "attendee" ? "attendee_invite" : "speaker_invite";
  const defaultSubject =
    params.inviteType === "attendee" ? `Invitation: ${params.event.name}` : `Speaker invitation: ${params.event.name}`;
  const primaryUrl =
    params.inviteType === "attendee"
      ? registrationPageUrl(params.appBaseUrl, params.event, { invite: "preview-token", source: "invite" })
      : proposalPageUrl(params.appBaseUrl, params.event, {
          invite: "preview-token",
          source: "speaker_invite",
        });
  const declineUrl = inviteDeclineUrl(params.appBaseUrl, params.event, "preview-token");
  const inviteExpiresAt = resolveEventInviteExpiry(params.event, params.expiresAt);
  const [renderBundle, digest] = await Promise.all([
    loadEmailRenderBundle(params.db, [templateKey]),
    computeAdminInviteDigest(params.invites, inviteExpiresAt),
  ]);
  const template = renderBundle.templates.get(templateKey)!;
  const preview = await signAdminInvitePreviewToken({
    secret: params.signingSecret,
    eventId: params.event.id,
    adminId: params.adminId,
    inviteType: params.inviteType,
    inviteDigest: digest,
    ttlSeconds: PREVIEW_TTL_SECONDS,
  });

  const data = {
    ...buildEventEmailVariables(params.event, params.appBaseUrl),
    firstName: firstInvite.firstName ?? (params.inviteType === "attendee" ? "Attendee" : "Speaker"),
    lastName: firstInvite.lastName ?? "",
    ...(params.inviteType === "attendee" ? { registrationUrl: primaryUrl } : { proposalUrl: primaryUrl }),
    declineUrl,
    inviteCount: params.invites.length,
    _partials: renderBundle.partials,
  };
  const subject = renderSubject(template.subjectTemplate, defaultSubject, data);
  const rendered = await renderEmail(
    template.content,
    data,
    renderBundle.layoutHtml,
    template.contentType as EmailContentType,
    params.appBaseUrl,
  );

  return {
    previewToken: preview.token,
    previewExpiresAt: preview.expiresAt,
    inviteDigest: digest,
    inviteExpiresAt,
    recipientCount: params.invites.length,
    subject,
    html: rendered.html,
    text: rendered.text,
  };
}
