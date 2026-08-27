import type { EmailContentType } from "../../../assets/shared/schemas/admin-email-templates";
import { escapeMarkdownText } from "./markdown";

const EMAIL_PLAIN_TEXT_KEY = "__pkicEmailPlainText";
const EMAIL_MARKDOWN_TEXT_KEY = "__pkicEmailMarkdownText";

/** Explicitly marks an untrusted value that a trusted email template must render as literal text. */
export interface EmailPlainTextValue {
  [EMAIL_PLAIN_TEXT_KEY]: string;
}

/** Marks authorized Markdown whose raw HTML must still be neutralized. */
export interface EmailMarkdownTextValue {
  [EMAIL_MARKDOWN_TEXT_KEY]: string;
}

export function emailPlainText(value: string): EmailPlainTextValue {
  return { [EMAIL_PLAIN_TEXT_KEY]: value };
}

export function emailMarkdownText(value: string): EmailMarkdownTextValue {
  return { [EMAIL_MARKDOWN_TEXT_KEY]: value };
}

function isEmailPlainTextValue(value: unknown): value is EmailPlainTextValue {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Partial<EmailPlainTextValue>)[EMAIL_PLAIN_TEXT_KEY] === "string"
  );
}

function isEmailMarkdownTextValue(value: unknown): value is EmailMarkdownTextValue {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Partial<EmailMarkdownTextValue>)[EMAIL_MARKDOWN_TEXT_KEY] === "string"
  );
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolvePlainText(value: string, mode: EmailContentType | "subject"): string {
  if (mode === "subject" || mode === "text") return value;
  if (mode === "html") return escapeHtmlText(value).replace(/\r?\n/g, "<br>");
  return value.split(/\r?\n/).map(escapeMarkdownText).join("  \n");
}

function resolveMarkdownText(value: string, mode: EmailContentType | "subject"): string {
  if (mode === "subject" || mode === "text") return value;
  if (mode === "html") return escapeHtmlText(value).replace(/\r?\n/g, "<br>");
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function resolveValue(value: unknown, mode: EmailContentType | "subject"): unknown {
  if (isEmailPlainTextValue(value)) return resolvePlainText(value[EMAIL_PLAIN_TEXT_KEY], mode);
  if (isEmailMarkdownTextValue(value)) return resolveMarkdownText(value[EMAIL_MARKDOWN_TEXT_KEY], mode);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, mode));
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, mode)]));
  }
  return value;
}

/** Resolves explicit plain-text wrappers without changing trusted URLs, markup, or control values. */
export function resolveEmailTemplateData(
  data: Record<string, unknown>,
  mode: EmailContentType | "subject",
): Record<string, unknown> {
  return resolveValue(data, mode) as Record<string, unknown>;
}
