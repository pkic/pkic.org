import { Extension } from "@tiptap/core";

/** Preserve unsupported authored syntax as visible text instead of dropping its contents. */
export const basicMarkdownLiterals = [
  ...["heading", "blockquote", "code", "hr", "table"].map((type) =>
    Extension.create({
      name: `basicLiteral${type}`,
      markdownTokenName: type,
      parseMarkdown(token, helpers) {
        const text = String(token.raw ?? token.text ?? "").trimEnd();
        return helpers.createNode("paragraph", undefined, text ? [helpers.createTextNode(text)] : []);
      },
    }),
  ),
  ...["image", "codespan", "del"].map((type) =>
    Extension.create({
      name: `basicLiteral${type}`,
      markdownTokenName: type,
      parseMarkdown(token, helpers) {
        return helpers.createTextNode(String(token.raw ?? token.text ?? ""));
      },
    }),
  ),
];
