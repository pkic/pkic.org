import { contentIconMarkup } from "../../site/ContentIcon";
import { Node } from "@tiptap/core";
import {
  contentAttributeNames,
  contentContainerNames,
  type ContentContainerName,
} from "../../../shared/schemas/content-layout";
import { CONTAINER_START, readMarkdownContainer, serializeMarkdownContainer } from "../../../shared/markdown-aside";
import { contentLayoutAttributes } from "../../site/ContentLayout";

function layoutExtension(name: ContentContainerName) {
  return Node.create({
    name,
    group: "block",
    content: name === "grid" ? "item+" : name === "cards" ? "card+" : "block+",
    defining: true,
    addAttributes() {
      return Object.fromEntries(
        contentAttributeNames.map((attribute) => [
          attribute,
          { default: null, parseHTML: (element: HTMLElement) => element.getAttribute(`data-${attribute}`) },
        ]),
      );
    },
    parseHTML() {
      return [
        {
          tag: `div.pk-content-${name}`,
          contentElement:
            name === "columns"
              ? ".pk-content-columns__body"
              : name === "card"
                ? ".pk-content-card__content"
                : undefined,
        },
      ];
    },
    renderHTML({ node }) {
      const attributes = contentLayoutAttributes({ type: name, ...node.attrs });
      if (name === "columns")
        return ["div", attributes, ["div", { class: "pk-content-prose pk-content-columns__body" }, 0]];
      if (name === "card") return ["div", attributes, ["div", { class: "pk-content-card__content" }, 0]];
      return ["div", attributes, 0];
    },
    addNodeView() {
      if (name !== "card") return null;
      return ({ node }) => {
        const dom = document.createElement("div");
        const icon = dom.appendChild(document.createElement("span"));
        icon.className = "pk-content-card__icon";
        icon.contentEditable = "false";
        icon.setAttribute("aria-hidden", "true");
        const contentDOM = dom.appendChild(document.createElement("div"));
        contentDOM.className = "pk-content-card__content";
        const update = (next: typeof node) => {
          if (next.type !== node.type) return false;
          for (const [key, value] of Object.entries(contentLayoutAttributes({ type: name, ...next.attrs }))) {
            if (value == null) {
              if (dom.hasAttribute(key)) dom.removeAttribute(key);
            } else if (dom.getAttribute(key) !== String(value)) dom.setAttribute(key, String(value));
          }
          icon.hidden = !next.attrs.icon;
          const markup = contentIconMarkup(next.attrs.icon ?? "") ?? "";
          if (icon.innerHTML !== markup) icon.innerHTML = markup;
          return true;
        };
        update(node);
        return {
          dom,
          contentDOM,
          update,
          ignoreMutation: (mutation) =>
            mutation.type !== "selection" &&
            (mutation.target === icon ||
              icon.contains(mutation.target) ||
              (mutation.type === "attributes" && mutation.target === dom)),
        };
      };
    },
    markdownTokenName: name,
    markdownTokenizer: {
      name,
      level: "block",
      start(source) {
        return source.search(CONTAINER_START);
      },
      tokenize(source, _tokens, lexer) {
        const result = readMarkdownContainer(source);
        return result?.block.type === name
          ? { type: name, raw: result.raw, block: result.block, tokens: lexer.blockTokens(result.block.markdown) }
          : undefined;
      },
    },
    parseMarkdown(token, helpers) {
      const block = token.block;
      const children = helpers.parseChildren(token.tokens ?? []);
      return helpers.createNode(
        name,
        Object.fromEntries(contentAttributeNames.map((attribute) => [attribute, block[attribute] ?? null])),
        children.length ? children : [{ type: "paragraph" }],
      );
    },
    renderMarkdown(node, helpers) {
      return serializeMarkdownContainer({
        type: name,
        ...Object.fromEntries(
          contentAttributeNames.map((attribute) => [attribute, node.attrs?.[attribute] ?? undefined]),
        ),
        markdown: helpers.renderChildren(node.content ?? [], "\n\n"),
      });
    },
  });
}
export const layoutExtensions = contentContainerNames.filter((name) => name !== "aside").map(layoutExtension);
