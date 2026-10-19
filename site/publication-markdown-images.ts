import { Marked } from "marked";
import { resolveMarkdownShortcodes } from "../assets/shared/markdown-shortcodes";
import { markdownSafeUrl } from "../assets/shared/markdown-media";

/** Match the existing Markdown renderer's parser and safe image-token inputs. */
export function markdownImageSources(values: readonly (string | null | undefined)[]) {
  const parser = new Marked();
  const sources: string[] = [];
  for (const markdown of values) {
    if (!markdown) continue;
    void parser.walkTokens(parser.lexer(resolveMarkdownShortcodes(markdown)), (token) => {
      if (token.type === "image" && markdownSafeUrl(token.href, true)) sources.push(token.href);
    });
  }
  return sources;
}
