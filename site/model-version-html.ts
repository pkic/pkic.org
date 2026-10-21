import { fromHtml } from "hast-util-from-html";
import { sanitize, defaultSchema } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import type { Element, RootContent } from "hast";
import { renderSiteMarkdown } from "./markdown-processor";
import { ANCHOR_ICON } from "../functions/_lib/services/site-headings";

/** Model branches are external publication inputs, not trusted website HTML. */
export async function renderModelMarkdown(markdown: string) {
  const tree = sanitize(fromHtml(await renderSiteMarkdown(markdown), { fragment: true }), {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      "*": [...(defaultSchema.attributes?.["*"] ?? []), "dataContentItemId", "ariaLabel"],
      a: [...(defaultSchema.attributes?.a ?? []), ["className", "header-link"]],
    },
  });
  if (tree.type !== "root") throw new Error("Expected a sanitized model document");
  const elements: Element[] = [];
  const pending: RootContent[] = [...tree.children];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "element") {
      elements.push(node);
      pending.push(...node.children);
    }
  }
  const ids = new Set(elements.map((node) => node.properties.id));
  for (const node of elements) {
    const href = node.properties.href;
    if (typeof href === "string" && href.startsWith("#") && ids.has(`user-content-${href.slice(1)}`)) {
      node.properties.href = `#user-content-${href.slice(1)}`;
    }
    // Restore only the site-owned permalink presentation after sanitizing source HTML.
    if (node.tagName === "a" && node.properties.ariaLabel === "Link to this section") {
      node.properties.className = ["header-link"];
      node.children = fromHtml(ANCHOR_ICON, { fragment: true }).children.filter(
        (child): child is Element => child.type === "element",
      );
    }
  }
  return toHtml(tree);
}
