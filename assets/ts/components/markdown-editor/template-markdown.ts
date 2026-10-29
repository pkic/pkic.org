import { decodeHtmlEntities } from "@tiptap/core";
import { isKnownCharacterReference } from "../../../shared/html-entities";
import { templateSyntaxSpans } from "../../shared/email-template-syntax";

/** Undo Markdown text escaping only inside template tokens after visual serialization. */
export function restoreTemplateMarkdown(markdown: string): string {
  let from = 0;
  let result = "";
  for (const span of templateSyntaxSpans(markdown)) {
    result += markdown.slice(from, span.from);
    result += decodeHtmlEntities(markdown.slice(span.from, span.to).replace(/\\([\\`*_[\]~])/g, "$1"));
    from = span.to;
  }
  return result + markdown.slice(from);
}

const CODE_OR_ENCODED_AMPERSAND = /(```[\s\S]*?```|`[^`\n]*`)|&amp;((?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);)?/g;

/**
 * The serializer HTML-encodes a typed `&`, so a bio saved from the editor would read
 * "R&amp;D" wherever the text is shown as plain text. Store the ampersand itself, leaving
 * code, and a typed reference such as `&amp;lt;` that a reader would take for a character, as written.
 */
export function plainAmpersands(markdown: string): string {
  return markdown.replace(CODE_OR_ENCODED_AMPERSAND, (match, code?: string, reference?: string) => {
    if (code) return code;
    return reference && isKnownCharacterReference(reference) ? match : `&${reference ?? ""}`;
  });
}
