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
    StarterKit.configure({
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
        return ["table", {}, ["tbody", 0]];
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
    TableRow,
    Video,
    Markdown,
  ];
}
