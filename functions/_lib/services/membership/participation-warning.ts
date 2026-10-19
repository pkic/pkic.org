import { emailPlainText } from "../../email/plain-text";
import type { DatabaseLike } from "../../types";
import type { EmailDraft } from "./notifications";
import { resolveOrganizationNoticeRecipient } from "./organization-notice-recipient";

/** Builds #208's editable warning with the canonical recipient policy; does not send or cancel membership. */
export async function buildOrganizationParticipationWarningEmail(
  db: DatabaseLike,
  organizationId: string,
  responseDeadlineText?: string,
): Promise<EmailDraft> {
  const recipient = await resolveOrganizationNoticeRecipient(db, organizationId);
  return {
    templateKey: "membership-participation-warning",
    recipientEmail: recipient.recipientEmail,
    messageType: "transactional",
    subject: "Your PKI Consortium membership participation",
    data: {
      organizationNameText: emailPlainText(recipient.organizationName),
      ...(recipient.contactName ? { contactNameText: emailPlainText(recipient.contactName) } : {}),
      ...(responseDeadlineText ? { responseDeadlineText: emailPlainText(responseDeadlineText) } : {}),
      noCurrentRepresentatives: recipient.noCurrentRepresentatives,
    },
  };
}
