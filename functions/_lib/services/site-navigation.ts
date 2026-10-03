import type { SiteNavigation, SiteNavigationItem } from "../../../assets/shared/site-content";
import { slugify, type MenuEntry } from "./site-markdown";

export interface NavigationDocument {
  /** Working-group metadata, carried so the mega menu can draw its cards. */
  card?: SiteNavigationItem["card"];
  menu?: Partial<Record<"footer" | "main", MenuEntry>>;
  published: boolean;
  route: string;
  title: string;
}

interface PendingMenuItem extends SiteNavigationItem {
  parent?: string;
  weight: number;
}

function menuItems(
  menuName: "footer" | "main",
  configured: Partial<Record<"footer" | "main", MenuEntry[]>>,
  documents: readonly NavigationDocument[],
): SiteNavigationItem[] {
  const entries: PendingMenuItem[] = [];
  for (const [position, entry] of (configured[menuName] ?? []).entries()) {
    const label = entry.name?.trim();
    if (!label) continue;
    entries.push({
      children: [],
      external: entry.params?.external,
      href: entry.url,
      identifier: entry.identifier ?? `${menuName}-config-${position}-${slugify(label)}`,
      label,
      parent: entry.parent,
      weight: entry.weight ?? 0,
    });
  }
  for (const document of documents) {
    const entry = document.menu?.[menuName];
    if (!entry || !document.published) continue;
    const label = (entry.name ?? document.title).trim();
    entries.push({
      card: document.card,
      children: [],
      external: entry.params?.external,
      href: entry.url ?? document.route,
      identifier: entry.identifier ?? document.route,
      label,
      parent: entry.parent,
      weight: entry.weight ?? 0,
    });
  }

  const byIdentifier = new Map(entries.map((entry) => [entry.identifier, entry]));
  const roots: PendingMenuItem[] = [];
  for (const entry of entries) {
    const parent = entry.parent ? byIdentifier.get(entry.parent) : undefined;
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  }
  const sortTree = (items: SiteNavigationItem[]): SiteNavigationItem[] =>
    items
      .sort((a, b) => {
        const weightedA = a as PendingMenuItem;
        const weightedB = b as PendingMenuItem;
        return (
          weightedA.weight - weightedB.weight ||
          a.label.localeCompare(b.label) ||
          (a.href ?? "").localeCompare(b.href ?? "")
        );
      })
      .map((item) => ({
        card: (item as PendingMenuItem).card,
        children: sortTree(item.children),
        external: item.external,
        href: item.href,
        identifier: item.identifier,
        label: item.label,
      }));
  return sortTree(roots);
}

export function buildSiteNavigation(
  configured: Partial<Record<"footer" | "main", MenuEntry[]>>,
  documents: readonly NavigationDocument[],
): SiteNavigation {
  return {
    footer: menuItems("footer", configured, documents),
    main: menuItems("main", configured, documents),
  };
}
