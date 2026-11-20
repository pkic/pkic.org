import { eventInvitationWording } from "../../../assets/shared/event-invitation-copy";
import { readEventInvitationMessage } from "../../../assets/shared/schemas/event-invitation-message";
import {
  emailMarkdownText,
  emailPlainText,
  type EmailMarkdownTextValue,
  type EmailPlainTextValue,
} from "../email/plain-text";
import { parseJsonSafe } from "../utils/json";

/** Shared, text-safe recipient variables for every event invitation email path. */
export function buildEventInviteRecipientVariables(
  invite: { firstName?: string | null; lastName?: string | null },
  fallbackName: string,
): { firstName: EmailPlainTextValue; lastName: EmailPlainTextValue; attendeeName: EmailPlainTextValue } {
  const firstName = invite.firstName?.trim() ?? "";
  const lastName = invite.lastName?.trim() ?? "";
  return {
    firstName: emailPlainText(firstName),
    lastName: emailPlainText(lastName),
    attendeeName: emailPlainText([firstName, lastName].filter(Boolean).join(" ") || fallbackName),
  };
}

/**
 * The event's own invitation wording for attendee invitations and their
 * reminders: `{{invitationHeadline}}` as text and `{{invitationMessage}}` as
 * Markdown with raw HTML neutralized. Without a message the headline is the
 * neutral default and the message is empty, so `{{#if invitationMessage}}` skips it.
 */
export function buildEventInvitationMessageVariables(event: { name: string; settings_json: string }): {
  invitationHeadline: EmailPlainTextValue;
  invitationMessage: EmailMarkdownTextValue;
} {
  const wording = eventInvitationWording(event, readEventInvitationMessage(parseJsonSafe(event.settings_json, {})));
  return {
    invitationHeadline: emailPlainText(wording.headline),
    invitationMessage: emailMarkdownText(wording.message ?? ""),
  };
}
