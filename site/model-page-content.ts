import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import type { RootContent } from "hast";
import { loadSiteContent, publishedSiteRoutes } from "../functions/_lib/services/site-content";
import type { ModelVersion } from "../assets/shared/model-versions";
import { modelContributionEntries } from "./model-versions";
import { modelScopedHref, modelVersionTree } from "./model-version-navigation";
import { loadModelLevelSource } from "./model-version-source";
import { createModelLevelContent } from "./model-level-content";
import { publication } from "./publication";

type ModelEntry = (typeof modelContributionEntries)[number];
const modelPageRouteCache = new WeakMap<ModelEntry, readonly string[]>();

/** Guidance is authored once; every model edition receives the complete page structure. */
export function modelPageRoutes(entry: ModelEntry): readonly string[] {
  const cached = modelPageRouteCache.get(entry);
  if (cached) return cached;
  const routes = publishedSiteRoutes().filter(
    (route) => route.startsWith(entry.root) && !/^(?:versions|drafts)\//.test(route.slice(entry.root.length)),
  );
  modelPageRouteCache.set(entry, routes);
  return routes;
}

export function scopeModelHtml(html: string, modelRoot: string, root: string) {
  const tree = fromHtml(html, { fragment: true });
  const pending: RootContent[] = [...tree.children];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type !== "element") continue;
    const href = node.properties.href;
    if (typeof href === "string") node.properties.href = modelScopedHref(href, modelRoot, root);
    pending.push(...node.children);
  }
  return toHtml(tree);
}

export async function loadModelPage(entry: ModelEntry, version: ModelVersion, sourceRoute: string, root: string) {
  const model = await loadModelLevelSource(
    entry.repository,
    version.sourcePath ?? entry.sourcePath,
    version,
    sourceRoute.slice(entry.root.length),
  );
  const level = model?.levels.find((item) => item.sourcePage === sourceRoute);
  if (model && !level) throw new Error(`Model ${version.version} has no level for ${sourceRoute}`);
  const levelContent = level ? createModelLevelContent(level) : undefined;
  const base = await loadSiteContent(sourceRoute, {
    publication,
    parameters: { version: version.status === "draft" ? `${version.version}-draft` : version.version },
    modelContent: levelContent?.render,
  });
  if (!base?.workingGroup) throw new Error(`Missing model page template: ${sourceRoute}`);
  const unplaced = levelContent?.unplaced() ?? [];
  if (unplaced.length)
    throw new Error(`${sourceRoute} does not place model ${version.version} content: ${unplaced.join(", ")}`);
  const route = `${root}${sourceRoute.slice(entry.root.length)}`;
  const sourceTree =
    base.workingGroup.sidebar ??
    base.workingGroup.treePanels?.find((panel) => panel.tree.root.href === entry.root)?.tree;
  if (!sourceTree) throw new Error(`Missing model navigation: ${sourceRoute}`);
  const tree = modelVersionTree(sourceTree, model, entry.root, root, route);
  return {
    ...base,
    route,
    robots: root === entry.root ? base.robots : "noindex, follow",
    html: scopeModelHtml(base.html, entry.root, root),
    workingGroup: {
      ...base.workingGroup,
      route,
      nav: base.workingGroup.nav.map((item) => ({ ...item, href: modelScopedHref(item.href, entry.root, root) })),
      sidebar: tree,
      treePanels: base.workingGroup.treePanels?.map((panel) =>
        panel.tree.root.href === entry.root ? { ...panel, tree } : panel,
      ),
    },
  };
}

export async function loadCurrentModelPage(route: string) {
  const entry = modelContributionEntries.find((entry) => modelPageRoutes(entry).includes(route));
  const version = entry?.versions.find((version) => version.id === entry.defaultVersion);
  return entry && version ? loadModelPage(entry, version, route, entry.root) : undefined;
}
