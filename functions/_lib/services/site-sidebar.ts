import type { SiteSidebarNode, SiteSidebarTree } from "../../../assets/shared/site-content";
import type { ContentDocument } from "./site-documents";

/**
 * The section navigation tree a working group's deliverables carry.
 *
 * Hugo built this in `partials/wg/sidebar-tree.html` and used it twice: as the
 * panel behind the section nav's chevron, and as the sticky aside on pages
 * that ask for a side menu. Both readings are the same tree, so both are built
 * here — the caller decides where it goes.
 *
 * The shape is the template's: three levels deep, child sections before the
 * loose pages at each level, and every branch containing the current page left
 * open so a reader lands with their own place already unfolded.
 */
export interface SidebarSource {
  documents: readonly ContentDocument[];
  isPublished: (document: ContentDocument) => boolean;
  label: (document: ContentDocument) => string;
}

/** Hugo's page ordering: `weight` first, then the title. */
function byWeightThenTitle(label: (document: ContentDocument) => string) {
  return (a: ContentDocument, b: ContentDocument) =>
    (a.data.weight ?? 0) - (b.data.weight ?? 0) || label(a).localeCompare(label(b));
}

/**
 * The `id` Hugo gave a tree panel: the deliverable's path as a single slug.
 *
 * `partials/wg/path-slug.html` trimmed the slashes and joined what was left
 * with hyphens, so `/wg/pqc/pqcmm/` addressed `wg-nav-tree-wg-pqc-pqcmm`.
 */
export function pathSlug(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replaceAll("/", "-");
}

export function createSidebar({ documents, isPublished, label }: SidebarSource) {
  const order = byWeightThenTitle(label);

  /** The documents one level under `parent`, sections before loose pages. */
  function childrenOf(parent: ContentDocument): ContentDocument[] {
    const prefix = `${parent.nodePath}/`;
    const children = documents.filter(
      (candidate) =>
        candidate !== parent &&
        candidate.language === parent.language &&
        candidate.nodePath.startsWith(prefix) &&
        !candidate.nodePath.slice(prefix.length).includes("/") &&
        isPublished(candidate),
    );
    return [
      ...children.filter((child) => child.isSection).sort(order),
      ...children.filter((child) => !child.isSection).sort(order),
    ];
  }

  function contains(ancestor: ContentDocument, page: ContentDocument): boolean {
    return ancestor === page || page.nodePath.startsWith(`${ancestor.nodePath}/`);
  }

  /** One entry, with its own children down to the template's third level. */
  function nodeFor(document: ContentDocument, page: ContentDocument, depth: number): SiteSidebarNode {
    const node: SiteSidebarNode = { current: document === page, href: document.route, label: label(document) };
    const children = depth >= 3 ? [] : childrenOf(document);
    if (children.length) {
      node.children = children.map((child) => nodeFor(child, page, depth + 1));
      node.open = contains(document, page);
    }
    return node;
  }

  /**
   * The tree for one deliverable section, as read from `page`.
   *
   * A level-one section marked `hideInSidebar` does not get a row of its own:
   * its children are promoted to the top of the panel, which is how the PQCMM
   * introduction pages sit above the numbered sections.
   */
  function sidebarTree(root: ContentDocument, page: ContentDocument): SiteSidebarTree {
    const level1 = childrenOf(root);
    const hidden = level1.filter((section) => section.isSection && section.data.hideInSidebar);
    const promoted = hidden.flatMap((section) => childrenOf(section).map((child) => nodeFor(child, page, 2)));
    return {
      promoted: promoted.length ? promoted : undefined,
      root: { current: root === page, href: root.route, label: label(root) },
      sections: level1.filter((section) => !section.data.hideInSidebar).map((section) => nodeFor(section, page, 1)),
    };
  }

  /**
   * The section a tree is drawn from: the group's own child that holds `page`.
   *
   * A page directly under the group — a charter, say — is its own root, which
   * is what makes its panel a single entry rather than the whole group.
   */
  function sidebarRootFor(page: ContentDocument, group: ContentDocument): ContentDocument | undefined {
    const prefix = `${group.nodePath}/`;
    if (!page.nodePath.startsWith(prefix)) return undefined;
    const [first] = page.nodePath.slice(prefix.length).split("/");
    return documents.find((candidate) => candidate.nodePath === `${prefix}${first}` && candidate.isSection);
  }

  /** Whether this page, or anything it sits under, asked for the side menu. */
  function hasSideMenu(page: ContentDocument): boolean {
    if (page.data.sideMenu) return true;
    const parts = page.nodePath.split("/");
    for (let depth = parts.length - 1; depth > 0; depth -= 1) {
      const ancestor = documents.find((candidate) => candidate.nodePath === parts.slice(0, depth).join("/"));
      if (ancestor?.data.sideMenu) return true;
    }
    return false;
  }

  return { childrenOf, hasSideMenu, sidebarRootFor, sidebarTree };
}
