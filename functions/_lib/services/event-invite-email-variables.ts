import { emailPlainText, type EmailPlainTextValue } from "../email/plain-text";

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
