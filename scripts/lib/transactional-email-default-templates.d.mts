import type { EmailContentType, EmailMessageType } from "../../assets/shared/schemas/email-templates";

export const DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES: Array<{
  key: string;
  subjectTemplate: string;
  content: string;
  contentType: EmailContentType;
  messageType: EmailMessageType;
}>;
