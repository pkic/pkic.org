import type {} from "mdast-util-to-hast";
import { unified } from "@astrojs/markdown-remark";
import remarkGemoji from "remark-gemoji";
import type { Root } from "hast";
import { toText } from "hast-util-to-text";
import { visit } from "unist-util-visit";

import { ANCHOR_ICON, headingAnchor } from "./site-headings";

/** Preserve the published site's presentation through Astro's supported plugin API. */
function sitePresentation() {
  return async (tree: Root, file: { data: { astro?: { frontmatter?: Record<string, unknown> } } }) => {
    const renderImage = file.data.astro?.frontmatter?.renderSiteImage as SiteImageRenderer | undefined;
    const headings = new Map<string, number>();
    const images: Promise<void>[] = [];
    visit(tree, "element", (node, index, parent) => {
      if (/^h[1-6]$/.test(node.tagName)) {
        const label = toText(node);
        const base = headingAnchor(label);
        const seen = headings.get(base) ?? 0;
        headings.set(base, seen + 1);
        const id = seen ? `${base}-${seen}` : base;
        node.properties.id = id;
        if (["h2", "h3", "h4"].includes(node.tagName)) {
          node.properties.ariaLabel = label;
          node.children.push({
            type: "raw",
            value: ` <a class="header-link" href="#${id}" aria-label="Link to this section">${ANCHOR_ICON}</a>`,
          });
        }
      }
      if (node.tagName === "table" && parent && index !== undefined) {
        node.properties.className = ["pk-table"];
        parent.children[index] = {
          type: "element",
          tagName: "div",
          properties: { className: ["pk-table__scroll", "pk-table__scroll--prose"] },
          children: [node],
        };
      }
      if (["th", "td"].includes(node.tagName)) {
        const alignment = String(node.properties.align ?? "");
        delete node.properties.align;
        if (alignment === "center" || alignment === "right")
          node.properties.className = [alignment === "center" ? "pk-center" : "pk-end"];
      }
      if (node.tagName === "pre" && parent && index !== undefined) {
        const code = node.children[0];
        if (
          code?.type === "element" &&
          (code.properties.className as string[] | undefined)?.includes("language-mermaid")
        ) {
          node.properties.className = ["mermaid"];
          node.children = code.children;
          parent.children[index] = {
            type: "element",
            tagName: "div",
            properties: { className: ["mermaid-wrap"] },
            children: [node],
          };
        }
      }
      if (node.tagName === "img" && renderImage && parent && index !== undefined) {
        const src = String(node.properties.src ?? "");
        images.push(
          (async () => {
            const html = await renderImage(
              src,
              String(node.properties.alt ?? ""),
              node.properties.title ? String(node.properties.title) : undefined,
            );
            parent.children[index] = { type: "raw", value: html };
          })(),
        );
      }
    });
    await Promise.all(images);
  };
}

export const siteMarkdownProcessor = unified({
  smartypants: false,
  remarkPlugins: [remarkGemoji],
  rehypePlugins: [sitePresentation],
});

// The same official processor renders shortcode bodies and dynamically loaded documents.
const renderer = siteMarkdownProcessor.createRenderer({ syntaxHighlight: false });
type SiteImageRenderer = (src: string, alt: string, title?: string) => Promise<string>;
export async function renderSiteMarkdown(source: string, renderSiteImage?: SiteImageRenderer): Promise<string> {
  return (await (await renderer).render(source, { frontmatter: { renderSiteImage } })).code;
}
