import type { InviteEmailQueueRow } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { buildEventInviteRecipientVariables } from "./event-invite-email-variables";
import { queuedCapabilityToken } from "./capability-links";
import { buildEventEmailVariables } from "./events";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl } from "./frontend-links";
import type { EventRouteRow } from "./reminders-support";
import { inviteExpirySeconds } from "../invite-validity";
import { AppError } from "../errors";

interface InviteEmailRecipient {
  id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
  expires_at: string | null;
}

export function buildInviteEmailQueueRow(payload: {
  event: EventRouteRow;
  invite: InviteEmailRecipient;
  appBaseUrl: string;
  source: string;
  subject: string;
  reminderCount: string;
  linkSecretFingerprint: string;
  inviterName?: string;
  daysUntilExpiry?: string;
}): InviteEmailQueueRow {
  const { event, invite } = payload;
  const isAttendee = invite.invite_type === "attendee";
  if (!invite.expires_at) {
    throw new AppError(409, "INVITE_EXPIRY_REQUIRED", "Invitation has no effective deadline");
  }
  const expiresAtSeconds = inviteExpirySeconds(invite.expires_at);
  const token = queuedCapabilityToken(
    "invite",
    invite.id,
    Math.max(1, expiresAtSeconds - Math.floor(Date.now() / 1000)),
    payload.linkSecretFingerprint,
    expiresAtSeconds,
  );
  const actionUrl = isAttendee
    ? registrationPageUrl(payload.appBaseUrl, event, {
        invite: token,
        inviteId: invite.id,
        source: payload.source,
      })
    : proposalPageUrl(payload.appBaseUrl, event, {
        invite: token,
        inviteId: invite.id,
        source: payload.source,
      });
  const declineUrl = inviteDeclineUrl(payload.appBaseUrl, event, token, invite.id);
  return {
    eventId: event.id,
    recipientEmail: invite.invitee_email,
    templateKey: isAttendee ? "attendee_invite" : "speaker_invite",
    subject: payload.subject,
    capabilityLinkValues: [actionUrl, declineUrl],
    data: {
      ...buildEventEmailVariables(event, payload.appBaseUrl),
      ...buildEventInviteRecipientVariables(
        { firstName: invite.invitee_first_name, lastName: invite.invitee_last_name },
        isAttendee ? "Attendee" : "Speaker",
      ),
      inviterName: emailPlainText(payload.inviterName ?? ""),
      registrationUrl: isAttendee ? actionUrl : undefined,
      proposalUrl: isAttendee ? undefined : actionUrl,
      declineUrl,
      isReminder: true,
      reminderCount: payload.reminderCount,
      daysUntilExpiry: payload.daysUntilExpiry ?? "",
    },
  };
}
