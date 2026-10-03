import { satteri } from "@astrojs/markdown-satteri";
import { nameToEmoji } from "gemoji";
import { toText } from "hast-util-to-text";
import type { HastPluginDefinition, MdastPluginDefinition } from "satteri";
import { ANCHOR_ICON, headingAnchor } from "../functions/_lib/services/site-headings";

const emoji: MdastPluginDefinition = {
  name: "site-emoji",
  text(node, context) {
    const value = node.value.replace(/:(\+1|[-\w]+):/g, (original, name: string) =>
      Object.hasOwn(nameToEmoji, name) ? nameToEmoji[name] : original,
    );
    if (value !== node.value) context.replaceNode(node, { type: "text", value });
  },
};

// Sätteri 0.10.5 includes adjacent closing table pipes in bare autolinks.
// Preserve the GFM table boundary without changing imported source documents.
const tableAutolinks: MdastPluginDefinition = {
  name: "site-table-autolinks",
  link(node, context) {
    if (context.parent(node)?.type !== "tableCell" || !node.url.endsWith("|")) return;
    const url = node.url.replace(/\|+$/, "");
    // Match a bare table cell; preserve explicitly authored or escaped links.
    if (!context.source.split("|").some((cell) => cell.trim() === url)) return;
    context.replaceNode(node, {
      type: "link",
      url,
      title: node.title,
      children: node.children.map((child) =>
        child.type === "text" ? { ...child, value: child.value.replace(/\|+$/, "") } : child,
      ),
    });
  },
};

/** Keep published presentation while using Sätteri's supported visitor API. */
function sitePresentation(): HastPluginDefinition {
  const headings = new Map<string, number>();
  return {
    name: "site-presentation",
    element: {
      filter: ["h1", "h2", "h3", "h4", "h5", "h6", "table", "th", "td", "pre", "img"],
      async visit(node, context) {
        if (/^h[1-6]$/.test(node.tagName)) {
          const label = toText(node);
          const base = headingAnchor(label);
          const seen = headings.get(base) ?? 0;
          headings.set(base, seen + 1);
          const id = seen ? `${base}-${seen}` : base;
          context.setProperty(node, "id", id);
          if (["h2", "h3", "h4"].includes(node.tagName)) {
            context.setProperty(node, "ariaLabel", label);
            context.appendChild(node, {
              type: "raw",
              value: ` <a class="header-link" href="#${id}" aria-label="Link to this section">${ANCHOR_ICON}</a>`,
            });
          }
        }
        if (node.tagName === "table") {
          context.setProperty(node, "className", ["pk-table"]);
          context.wrapNode(node, {
            type: "element",
            tagName: "div",
            properties: { className: ["pk-table__scroll", "pk-table__scroll--prose"] },
            children: [],
          });
        }
        if (["th", "td"].includes(node.tagName)) {
          const alignment = String(node.properties.style ?? "").match(/text-align:\s*(center|right)/)?.[1];
          context.setProperty(node, "style", null);
          if (alignment) context.setProperty(node, "className", [alignment === "center" ? "pk-center" : "pk-end"]);
        }
        if (node.tagName === "pre") {
          const code = node.children[0];
          if (
            code?.type === "element" &&
            (code.properties.className as string[] | undefined)?.includes("language-mermaid")
          ) {
            context.replaceNode(node, {
              type: "element",
              tagName: "div",
              properties: { className: ["mermaid-wrap"] },
              children: [
                { type: "element", tagName: "pre", properties: { className: ["mermaid"] }, children: code.children },
              ],
            });
          }
        }
        const renderImage = (
          context.data.astro as { frontmatter?: { renderSiteImage?: SiteImageRenderer } } | undefined
        )?.frontmatter?.renderSiteImage;
        if (node.tagName === "img" && renderImage) {
          const html = await renderImage(
            String(node.properties.src ?? ""),
            String(node.properties.alt ?? ""),
            node.properties.title ? String(node.properties.title) : undefined,
          );
          context.replaceNode(node, { type: "raw", value: html });
        }
      },
    },
  };
}

export const siteMarkdownProcessor = satteri({
  features: { smartPunctuation: false },
  mdastPlugins: [emoji, tableAutolinks],
  hastPlugins: [sitePresentation],
});
const renderer = siteMarkdownProcessor.createRenderer({ syntaxHighlight: false, smartypants: false });
type SiteImageRenderer = (src: string, alt: string, title?: string) => Promise<string>;

export async function renderSiteMarkdown(source: string, renderSiteImage?: SiteImageRenderer): Promise<string> {
  return (await (await renderer).render(source, { frontmatter: { renderSiteImage } })).code;
}
