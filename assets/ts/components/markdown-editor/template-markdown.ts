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

const CODE_OR_ENCODED_CHARACTER =
  /(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|(`+)(?!`)[^\n]*?[^`\n]\2(?!`))|&(lt|gt);|&amp;((?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);)?/g;

/** Where a `>` would open a quote: at a line start, or after list markers and other quote markers. */
const QUOTE_POSITION = /(^|\n)[ ]{0,3}(?:(?:[-+*]|\d{1,9}[.)])[ ]+)*$/;

/**
 * The serializer HTML-encodes a typed `&`, `<` and `>`, so a bio saved from the editor would read
 * "R&amp;D" or "a &lt; b" wherever the text is shown as plain text. Markdown needs none of that:
 * store the characters themselves, leaving code, and a typed reference such as `&amp;lt;` that a
 * reader would take for a character, as written. A `<` that could open a tag and a `>` that
 * could open a quote take the backslash Markdown gives them instead.
 */
export function plainAmpersands(markdown: string): string {
  return markdown.replace(
    CODE_OR_ENCODED_CHARACTER,
    (
      match,
      code: string | undefined,
      _ticks: string | undefined,
      bracket: string | undefined,
      reference: string | undefined,
      offset: number,
    ) => {
      if (code) return code;
      if (bracket === "lt") return /^[A-Za-z/!?]/.test(markdown.slice(offset + match.length)) ? "\\<" : "<";
      if (bracket === "gt") return QUOTE_POSITION.test(markdown.slice(0, offset)) ? "\\>" : ">";
      return reference && isKnownCharacterReference(reference) ? match : `&${reference ?? ""}`;
    },
  );
}
