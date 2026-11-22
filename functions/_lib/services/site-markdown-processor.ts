import type {} from "mdast-util-to-hast";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { VFile } from "vfile";
import type { Root } from "hast";
import { toText } from "hast-util-to-text";
import { visit } from "unist-util-visit";

import { ANCHOR_ICON, headingAnchor } from "./site-headings";

type SiteImageRenderer = (src: string, alt: string, title?: string) => Promise<string>;

declare module "vfile" {
  interface DataMap {
    /** Renders a Markdown image as the site's responsive picture. */
    renderSiteImage: SiteImageRenderer;
  }
}

/** Preserve the published site's presentation. */
function sitePresentation() {
  return async (tree: Root, file: VFile) => {
    const renderImage = file.data.renderSiteImage;
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

// Cloudflare Workers cannot load Sätteri's native or threaded WASM binding.
// Astro replaces this module with site/markdown-processor.ts at build time.
// The Worker builds the same remark and rehype chain as Astro's renderer
// without importing it: that module bundles every syntax highlighter
// language, which the site never uses and the Worker would load on each start.
const renderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkGemoji)
  .use(remarkRehype, { allowDangerousHtml: true, passThrough: [] })
  .use(sitePresentation)
  .use(rehypeRaw)
  .use(rehypeStringify, { allowDangerousHtml: true });
export async function renderSiteMarkdown(source: string, renderSiteImage?: SiteImageRenderer): Promise<string> {
  const file = new VFile({ value: source, data: renderSiteImage ? { renderSiteImage } : {} });
  return String((await renderer.process(file)).value);
}
