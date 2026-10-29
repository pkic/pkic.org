import { Node } from "@tiptap/core";
import { CONTENT_ASIDE_NAME } from "../../../shared/schemas/content-aside";
import { ASIDE_START, tryReadMarkdownContainer, serializeMarkdownAside } from "../../../shared/markdown-aside";
import { CONTENT_ASIDE_ATTRIBUTES } from "../../site/ContentAside";

/** The body is editable block content, rather than an opaque embedded widget. */
export const AsideExtension = Node.create({
  name: CONTENT_ASIDE_NAME,
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "aside.pk-content-aside" }];
  },
  renderHTML() {
    return ["aside", CONTENT_ASIDE_ATTRIBUTES, 0];
  },
  markdownTokenName: CONTENT_ASIDE_NAME,
  markdownTokenizer: {
    name: CONTENT_ASIDE_NAME,
    level: "block",
    start(source) {
      return source.search(ASIDE_START);
    },
    tokenize(source, _tokens, lexer) {
      const aside = tryReadMarkdownContainer(source);
      return aside?.block.type === CONTENT_ASIDE_NAME
        ? { type: CONTENT_ASIDE_NAME, raw: aside.raw, tokens: lexer.blockTokens(aside.block.markdown) }
        : undefined;
    },
  },
  parseMarkdown(token, helpers) {
    const children = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode(CONTENT_ASIDE_NAME, undefined, children.length ? children : [{ type: "paragraph" }]);
  },
  renderMarkdown(node, helpers) {
    return serializeMarkdownAside(helpers.renderChildren(node.content ?? [], "\n\n"));
  },
});
