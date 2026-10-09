import type { EmailContentType } from "../assets/shared/schemas/email-templates";

export const DEFAULT_LAYOUT_HTML: string;

export const DEFAULT_TEMPLATES: Array<{
  key: string;
  subjectTemplate: string | null;
  contentType?: EmailContentType;
  content: string;
}>;
