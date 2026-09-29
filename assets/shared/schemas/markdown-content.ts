import { z } from "zod";
import { supportedMarkdownShortcodeList, unsupportedMarkdownShortcodeNames } from "../markdown-shortcodes";

/**
 * A stored Markdown field, bounded and refusing syntax the renderer cannot
 * honour.
 *
 * The renderer drops an unsupported `{{< … >}}` rather than printing it (see
 * `assets/shared/markdown-shortcodes.ts`), which is right for the reader and
 * silent for the author — so the author is told here instead, at the moment
 * they try to save it, through the same contract their form validates
 * against. One basis for validation: the message names the shortcodes that do
 * work, so nobody has to find this file to learn the rule.
 */
export function markdownContentSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .superRefine((value, ctx) => {
      const unsupported = unsupportedMarkdownShortcodeNames(value);
      if (unsupported.length === 0) return;
      ctx.addIssue({
        code: "custom",
        message:
          `This is Markdown, not a Hugo page: ${unsupported.map((name) => `{{< ${name} >}}`).join(", ")} ` +
          `${unsupported.length === 1 ? "is" : "are"} not rendered. ` +
          `Supported shortcodes: ${supportedMarkdownShortcodeList()}. ` +
          `A YouTube or Vimeo link on a line of its own becomes an embedded video.`,
      });
    });
}
