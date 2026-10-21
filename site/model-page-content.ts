import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import type { RootContent } from "hast";
import { loadSiteContent, publishedSiteRoutes } from "../functions/_lib/services/site-content";
import type { ModelVersion } from "../assets/shared/model-versions";
import { modelContributionEntries } from "./model-versions";
import { modelScopedHref, modelVersionTree } from "./model-version-navigation";
import { loadModelVersion } from "./model-version-source";
import { modelVersionMarkdown } from "./model-version-markdown";
import { renderModelMarkdown } from "./model-version-html";
import { publication } from "./publication";

type ModelEntry = (typeof modelContributionEntries)[number];

/** Guidance is authored once; every model edition receives the complete page structure. */
export function modelPageRoutes(entry: ModelEntry) {
  return publishedSiteRoutes().filter(
    (route) => route.startsWith(entry.root) && !/^(?:versions|drafts)\//.test(route.slice(entry.root.length)),
  );
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
  const base = await loadSiteContent(sourceRoute, { publication, parameters: { version: version.version } });
  if (!base?.workingGroup) throw new Error(`Missing model page template: ${sourceRoute}`);
  const model = await loadModelVersion(entry.repository, version.sourcePath ?? entry.sourcePath, version);
  const route = `${root}${sourceRoute.slice(entry.root.length)}`;
  const sourceTree =
    base.workingGroup.sidebar ??
    base.workingGroup.treePanels?.find((panel) => panel.tree.root.href === entry.root)?.tree;
  if (!sourceTree) throw new Error(`Missing model navigation: ${sourceRoute}`);
  const tree = modelVersionTree(sourceTree, model, entry.root, root, route);
  const level = model.levels.find((item) => item.sourcePage === sourceRoute);
  const html = level ? await renderModelMarkdown(modelVersionMarkdown(model, root, level.number)) : base.html;
  return {
    ...base,
    route,
    robots: root === entry.root ? base.robots : "noindex, follow",
    html: scopeModelHtml(html, entry.root, root),
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
