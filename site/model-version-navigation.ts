import type { SiteSidebarNode, SiteSidebarTree } from "../assets/shared/site-content";
import type { ReadableModel } from "./model-version-source";

/** Project model-owned destinations once for sidebar and dropdown navigation. */
export function modelScopedHref(href: string, modelRoot: string, root: string): string {
  if (!href.startsWith(modelRoot)) return href;
  const suffix = href.slice(modelRoot.length);
  if (/^(?:versions|drafts)\//.test(suffix)) return href;
  return `${root}${suffix}`;
}

export function modelVersionTree(
  tree: SiteSidebarTree,
  model: ReadableModel | undefined,
  modelRoot: string,
  root: string,
  route: string,
): SiteSidebarTree {
  const project = (node: SiteSidebarNode): SiteSidebarNode => {
    const href = modelScopedHref(node.href, modelRoot, root);
    const children =
      model && node.href === `${modelRoot}levels/`
        ? model.levels.map((level) =>
            project({ label: `${level.number} — ${level.name}`, href: level.sourcePage, current: false }),
          )
        : node.children?.map(project);
    return { ...node, href, current: route === href, open: route.startsWith(href), children };
  };
  return {
    ...tree,
    root: project(tree.root),
    promoted: tree.promoted?.map(project),
    sections: tree.sections.map(project),
  };
}
