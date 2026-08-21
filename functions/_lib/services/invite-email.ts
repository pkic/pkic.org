import type { InviteEmailQueueRow } from "../email/outbox";
import { queuedCapabilityToken } from "./capability-links";
import { buildEventEmailVariables } from "./events";
import { inviteDeclineUrl, proposalPageUrl, registrationPageUrl } from "./frontend-links";
import type { EventRouteRow } from "./reminders-support";

interface InviteEmailRecipient {
  id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
}

export function buildInviteEmailQueueRow(payload: {
  event: EventRouteRow;
  invite: InviteEmailRecipient;
  appBaseUrl: string;
  source: string;
  subject: string;
  reminderCount: string;
  inviterName?: string;
  daysUntilExpiry?: string;
}): InviteEmailQueueRow {
  const { event, invite } = payload;
  const isAttendee = invite.invite_type === "attendee";
  const token = queuedCapabilityToken("invite", invite.id);
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
      firstName: invite.invitee_first_name ?? "",
      lastName: invite.invitee_last_name ?? "",
      inviterName: payload.inviterName ?? "",
      registrationUrl: isAttendee ? actionUrl : undefined,
      proposalUrl: isAttendee ? undefined : actionUrl,
      declineUrl,
      isReminder: true,
      reminderCount: payload.reminderCount,
      daysUntilExpiry: payload.daysUntilExpiry ?? "",
      __subjectOverride: payload.subject,
    },
  };
}
