import { layoutExtensions } from "./layout-extensions";
import "../../ui/Table.css";
import { AsideExtension } from "./aside-extension";
import { Node } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Image } from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { markdownSafeUrl, markdownVideoEmbed } from "../../../shared/markdown-media";

const Video = Node.create({
  name: "memberVideo",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: "" } };
  },
  parseHTML() {
    return [
      { tag: "div[data-member-video]", getAttrs: (element) => ({ url: element.getAttribute("data-member-video") }) },
    ];
  },
  renderHTML({ node }) {
    const url = markdownVideoEmbed(String(node.attrs.url));
    return url
      ? [
          "div",
          { "data-member-video": node.attrs.url, class: "pk-markdown-editor__video" },
          ["iframe", { src: url, title: "Embedded video", class: "pk-framed pk-embed", loading: "lazy" }],
        ]
      : ["p", {}, "Video unavailable"];
  },
  markdownTokenName: "memberVideo",
  markdownTokenizer: {
    name: "memberVideo",
    level: "block",
    start: (source) => source.search(/^https?:\/\//m),
    tokenize(source) {
      const match = /^(https?:\/\/[^\s]+)(?:\n|$)/.exec(source);
      if (match && markdownVideoEmbed(match[1])) return { type: "memberVideo", raw: match[0], url: match[1] };
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode("memberVideo", { url: token.url });
  },
  renderMarkdown(node) {
    return String(node.attrs?.url ?? "");
  },
});

/** Native table sizing uses inline styles; this portal uses stylesheet sizing. */
export function editorExtensions() {
  return [
    StarterKit.extend({
      addExtensions() {
        return (this.parent?.() ?? []).map((extension) =>
          extension.name === "orderedList"
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
      heading: { levels: [2, 3, 4] },
      link: { openOnClick: false },
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
    }),
    Image.extend({
      renderHTML({ node }) {
        const src = String(node.attrs.src);
        return markdownSafeUrl(src, true)
          ? ["img", { src, alt: node.attrs.alt ?? "", title: node.attrs.title }]
          : ["span", {}, node.attrs.alt ?? "Image unavailable"];
      },
    }),
    Table.extend({
      renderHTML() {
        return ["table", { class: "pk-table" }, ["tbody", 0]];
      },
      addNodeView() {
        return () => {
          const dom = document.createElement("div");
          dom.className = "pk-table__scroll pk-table__scroll--prose";
          const table = dom.appendChild(document.createElement("table"));
          table.className = "pk-table";
          const contentDOM = table.appendChild(document.createElement("tbody"));
          return { dom, contentDOM };
        };
      },
    }).configure({ resizable: false, View: null }),
    TableCell.extend({
      content: "paragraph",
      renderHTML() {
        return ["td", {}, 0];
      },
    }),
    TableHeader.extend({
      content: "paragraph",
      renderHTML() {
        return ["th", {}, 0];
      },
    }),
    AsideExtension,
    ...layoutExtensions,
    TableRow,
    Video,
    Markdown,
  ];
}
