/**
 * The words the interface uses for the two email vocabularies the API owns.
 *
 * The template list, the template editor and the event campaign composer all
 * offer these choices, so the labels are written once here while the values
 * come from the contract. Each label map is total on its vocabulary on
 * purpose: a type added to `api-common` stops the build in this file instead
 * of quietly going missing from three selects.
 */
import {
  emailContentTypeSchema,
  emailMessageTypeSchema,
  type EmailContentType,
  type EmailMessageType,
} from "../../shared/schemas/api-common";

const EMAIL_CONTENT_TYPE_LABELS: Record<EmailContentType, string> = {
  markdown: "Markdown",
  html: "HTML",
  text: "Plain text",
};

const EMAIL_MESSAGE_TYPE_LABELS: Record<EmailMessageType, string> = {
  transactional: "Transactional",
  promotional: "Promotional",
};

export const EMAIL_CONTENT_TYPE_OPTIONS: ReadonlyArray<{ value: EmailContentType; label: string }> =
  emailContentTypeSchema.options.map((contentType) => ({
    value: contentType,
    label: EMAIL_CONTENT_TYPE_LABELS[contentType],
  }));

export const EMAIL_MESSAGE_TYPE_OPTIONS: ReadonlyArray<{ value: EmailMessageType; label: string }> =
  emailMessageTypeSchema.options.map((messageType) => ({
    value: messageType,
    label: EMAIL_MESSAGE_TYPE_LABELS[messageType],
  }));
