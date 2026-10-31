import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { basicMarkdownLiterals } from "./basic-markdown-literals";

export type MarkdownEditorProfile = "basic" | "content";

export function starterExtension(profile: MarkdownEditorProfile) {
  const basic = profile === "basic";
  return StarterKit.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map((extension) =>
        basic && extension.name === "paragraph"
          ? extension.extend({
              parseMarkdown(token, helpers) {
                if (token.tokens?.length === 1 && token.tokens[0].type === "image")
                  return helpers.createNode("paragraph", undefined, helpers.parseInline(token.tokens));
                return extension.config.parseMarkdown?.(token, helpers) ?? null;
              },
            })
          : extension.name === "orderedList"
            ? extension.extend({
                // Use Markdown's numeric list grammar. The extended alphabetical
                // tokenizer mistakes ordinary titles such as Ir. and Dr. for lists.
                markdownTokenizer: {
                  name: "orderedList",
                  level: "block",
                  start: () => -1,
                  tokenize: () => undefined,
                },
              })
            : extension,
      );
    },
  }).configure({
    underline: false,
    heading: basic ? false : { levels: [2, 3, 4] },
    blockquote: basic ? false : {},
    code: basic ? false : {},
    codeBlock: basic ? false : {},
    horizontalRule: basic ? false : {},
    strike: basic ? false : {},
    link: { openOnClick: false },
    dropcursor: false,
    gapcursor: false,
    trailingNode: false,
  });
}

export function basicEditorExtensions() {
  return [starterExtension("basic"), ...basicMarkdownLiterals, Markdown];
}
