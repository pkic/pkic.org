import type { EmailContentType } from "../../../assets/shared/schemas/email-templates";
import { assertEmailTemplateRenderLength } from "./render-limit";

const MESSAGE_PLACEHOLDER_PATTERN = /\{\{\{\s*message\s*\}\}\}|\{\{\s*message\s*\}\}/g;

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapedHtmlLength(input: string): number {
  let length = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    length +=
      character === "&"
        ? 5
        : character === "<" || character === ">"
          ? 4
          : character === '"'
            ? 6
            : character === "\n"
              ? 5
              : 1;
  }
  return length;
}

function messagePlaceholderStats(template: string): { count: number; characters: number } {
  const stats = { count: 0, characters: 0 };
  for (const match of template.matchAll(MESSAGE_PLACEHOLDER_PATTERN)) {
    stats.count += 1;
    stats.characters += match[0].length;
  }
  return stats;
}

function replaceMessagePlaceholders(content: string, replacement: string): string {
  return content.replace(MESSAGE_PLACEHOLDER_PATTERN, () => replacement);
}

export function applyCampaignCustomText(
  templateContent: string,
  contentType: EmailContentType,
  customText: string | null | undefined,
): string {
  const text = (customText ?? "").trim();
  const removeMessageTag = (content: string): string => content.replace(MESSAGE_PLACEHOLDER_PATTERN, "");

  if (!text) return removeMessageTag(templateContent);

  const placeholders = messagePlaceholderStats(templateContent);
  if (placeholders.count === 0) return templateContent;

  const replacementLength = contentType === "html" ? escapedHtmlLength(text) : text.length;
  assertEmailTemplateRenderLength(
    templateContent.length - placeholders.characters + placeholders.count * replacementLength,
  );

  if (contentType === "html") {
    const safe = escapeHtml(text).replace(/\n/g, "<br>\n");
    return replaceMessagePlaceholders(templateContent, safe);
  }

  return replaceMessagePlaceholders(templateContent, text);
}
