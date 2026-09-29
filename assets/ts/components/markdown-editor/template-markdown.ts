import { decodeHtmlEntities } from "@tiptap/core";
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
