import type { SiteSidebarTree } from "../assets/shared/site-content";
import type { ReadableModel } from "./model-version-source";
import { modelLevelSlug } from "./model-version-markdown";

/** Keep every model level inside the version being read, using the existing content tree. */
export function modelVersionTree(
  tree: SiteSidebarTree,
  model: ReadableModel,
  modelRoot: string,
  root: string,
  route: string,
): SiteSidebarTree {
  const levels = model.levels.map((level) => {
    const href = `${root}levels/${modelLevelSlug(level)}/`;
    return { label: `${level.number} — ${level.name}`, href, current: route === href };
  });
  return {
    ...tree,
    root: { ...tree.root, href: root, current: route === root },
    sections: tree.sections.map((section) =>
      section.href === `${modelRoot}levels/`
        ? { ...section, href: root, current: false, open: route !== root, children: levels }
        : { ...section, current: false, open: false },
    ),
  };
}
