import type {
  SiteListingItem,
  SiteSidebarTree,
  SiteWorkingGroupCard,
  SiteWorkingGroupExploreCard,
  SiteWorkingGroupKeyDeliverable,
  SiteWorkingGroupSection,
  SiteWorkingGroupSectionKey,
} from "../../../assets/shared/site-content";
import type { FrontMatter } from "./site-markdown";
import { pathSlug } from "./site-sidebar";

/**
 * The five sub-pages every working group publishes.
 *
 * Hugo built these with the `content/wg/_content.gotmpl` content adapter so a
 * group writes its focus areas, deliverables and resources once, in its own
 * `_index.md`, and still gets an addressable page per section. The order is
 * the adapter's `navOrder`.
 */
export const WORKING_GROUP_SECTIONS: ReadonlyArray<{
  heading: (groupTitle: string) => string;
  key: SiteWorkingGroupSectionKey;
  lead: (groupTitle: string) => string;
  navLabel: string;
  title: string;
}> = Object.freeze([
  {
    heading: () => "Focus Areas",
    key: "focus",
    lead: (groupTitle) => `What the ${groupTitle} focuses on`,
    navLabel: "Focus Areas",
    title: "Focus Areas",
  },
  {
    heading: () => "What We're Working On",
    key: "deliverables",
    lead: (groupTitle) => `Current and planned deliverables of the ${groupTitle}`,
    navLabel: "Deliverables",
    title: "Deliverables",
  },
  {
    heading: () => "Working Group Members",
    key: "members",
    lead: (groupTitle) => `Organizations actively participating in the ${groupTitle}`,
    navLabel: "Members",
    title: "Members",
  },
  {
    heading: () => "Industry Resources",
    key: "resources",
    lead: (groupTitle) => `Useful references and external resources from the ${groupTitle}`,
    navLabel: "Resources",
    title: "Resources",
  },
  {
    heading: () => "Blog",
    key: "blog",
    lead: (groupTitle) => `Recent posts related to the ${groupTitle}`,
    navLabel: "Blog",
    title: "Blog",
  },
]);

const ACCENTS = new Set(["blue", "green", "orange", "purple", "teal"]);

/** The accent a group declares, falling back to the consortium green. */
export function workingGroupAccent(data: FrontMatter): string {
  const color = String(data.color ?? "").toLowerCase();
  return ACCENTS.has(color) ? color : "green";
}

function isExternal(url: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(url);
}

function cardsFor(section: SiteWorkingGroupSection["section"], data: FrontMatter): SiteWorkingGroupCard[] {
  if (section === "focus") {
    return (data.focus ?? [])
      .filter((entry) => entry.title)
      .map((entry) => ({ description: entry.description, icon: entry.icon, title: entry.title! }));
  }
  if (section === "deliverables") {
    return (data.deliverables ?? [])
      .filter((entry) => entry.title)
      .map((entry) => ({
        description: entry.description,
        external: entry.url ? isExternal(entry.url) : undefined,
        href: entry.url,
        status: entry.status ?? "active",
        title: entry.title!,
      }));
  }
  if (section === "resources") {
    return (data.resources ?? [])
      .filter((entry) => entry.title && entry.url)
      .map((entry) => ({
        description: entry.description,
        external: isExternal(entry.url!),
        href: entry.url,
        title: entry.title!,
      }));
  }
  return [];
}

export type WorkingGroupSectionName = SiteWorkingGroupSection["section"];

/** Icon and label for each generated section, as the landing grid shows them. */
const EXPLORE_CARDS: ReadonlyArray<{ icon: string; key: SiteWorkingGroupSectionKey; noun: string; title: string }> = [
  { icon: "🎯", key: "focus", noun: "active focus areas", title: "Focus Areas" },
  { icon: "📦", key: "deliverables", noun: "deliverables and work items", title: "Deliverables" },
  { icon: "📚", key: "resources", noun: "curated resources", title: "Resources" },
];

export interface WorkingGroupSectionInput {
  base: string;
  /** Crumbs between the group and this page, for a page the group authors itself. */
  breadcrumbTrail?: Array<{ href: string; label: string }>;
  /** The group's own child pages, in publication order. */
  children: Array<{ href: string; label: string; slug: string }>;
  data: FrontMatter;
  /** The conferences section's two bands, when this is that page. */
  conferences?: { past: SiteListingItem[]; upcoming: SiteListingItem[] };
  /** Whether a deliverable's own section has pages under it, so it earns a tree panel. */
  deliverableHasChildren?: (url: string) => boolean;
  /** The standfirst of a page the group authors itself. */
  description?: string;
  groupTitle: string;
  /** The title of a page the group authors itself, which is not a generated heading. */
  pageTitle?: string;
  posts: SiteListingItem[];
  route: string;
  section: WorkingGroupSectionName;
  sidebar?: SiteSidebarTree;
  treePanels?: SiteWorkingGroupSection["treePanels"];
  wgId: string;
}

/** Hugo truncated a deliverable's tab label at 22 characters. */
function tabLabel(value: string): string {
  return value.length > 22 ? `${value.slice(0, 22).trimEnd()}…` : value;
}

/**
 * The rendered shape of one working-group sub-page.
 *
 * The section nav lists the group's landing page, any real child pages it
 * owns, and the generated sections the group actually has content for — a
 * group without resources gets no Resources tab, exactly as `wg-sub.html`
 * decided it.
 */
export function workingGroupSection(input: WorkingGroupSectionInput): SiteWorkingGroupSection {
  const { base, children, data, groupTitle, posts, route, section, wgId } = input;
  const { breadcrumbTrail = [], deliverableHasChildren, description, pageTitle, sidebar, treePanels } = input;
  const conferenceBands = input.conferences;
  const definition = WORKING_GROUP_SECTIONS.find((candidate) => candidate.key === section);
  const tab = (href: string, label: string) => ({ current: route === href, href, label });
  const child = (slug: string) => children.find((candidate) => candidate.slug === slug);
  const charter = child("charter");
  const conferences = child("conferences");
  // The deliverables that live under this group get their own tab; the rest
  // are reachable from the Deliverables page.
  const ownDeliverables = (data.deliverables ?? []).filter((entry) => entry.url?.startsWith(base));
  const keyDeliverableTab = {
    current: false,
    href: "#wg-key-deliverables",
    label: "Deliverables",
    target: "wg-key-deliverables",
  };
  const nav = [
    tab(base, "About"),
    // The landing page's own headline block is a scroll target, not a page,
    // and it sits ahead of the charter exactly as `wg/section.html` placed it.
    ...(section === "about" && (data.keyDeliverables ?? []).length ? [keyDeliverableTab] : []),
    ...(charter ? [tab(charter.href, "Charter")] : []),
    ...(cardsFor("focus", data).length ? [tab(`${base}focus/`, "Focus Areas")] : []),
    ...(ownDeliverables.length
      ? ownDeliverables.map((entry) => ({
          current: route.startsWith(entry.url!),
          href: entry.url!,
          label: tabLabel(entry.menuTitle ?? entry.title ?? ""),
          panel: deliverableHasChildren?.(entry.url!) ? `wg-nav-tree-${pathSlug(entry.url!)}` : undefined,
        }))
      : cardsFor("deliverables", data).length
        ? [tab(`${base}deliverables/`, "Deliverables")]
        : []),
    tab(`${base}members/`, "Members"),
    ...(cardsFor("resources", data).length ? [tab(`${base}resources/`, "Resources")] : []),
    ...(conferences ? [tab(conferences.href, "Conferences")] : []),
    tab(`${base}blog/`, "Blog"),
  ];
  const joinLink = data.heroButton?.link ?? `/portal/#/groups/${wgId.toLowerCase()}`;
  const keyDeliverables: SiteWorkingGroupKeyDeliverable[] = (data.keyDeliverables ?? [])
    .filter((entry) => entry.title)
    .map((entry) => ({
      badge: entry.badge,
      cta: entry.cta ?? "Learn More",
      description: entry.description,
      href: entry.url,
      icon: entry.icon,
      title: entry.title!,
    }));
  const explore: SiteWorkingGroupExploreCard[] = EXPLORE_CARDS.flatMap((card) => {
    const count = cardsFor(card.key, data).length;
    if (!count) return [];
    return [{ count: `${count} ${card.noun}`, href: `${base}${card.key}/`, icon: card.icon, title: card.title }];
  });
  return {
    accent: workingGroupAccent(data),
    base,
    breadcrumb: [{ href: "/wg/", label: "Working Groups" }, { href: base, label: wgId }, ...breadcrumbTrail],
    cards: cardsFor(section, data),
    conferences: conferenceBands,
    description,
    explore: section === "about" ? explore : undefined,
    groupTitle,
    heading: definition?.heading(groupTitle) ?? groupTitle,
    join: { href: joinLink, label: data.heroButton?.label ?? "Join this Working Group" },
    keyDeliverables: section === "about" && keyDeliverables.length ? keyDeliverables : undefined,
    lead: definition?.lead(groupTitle) ?? "",
    nav,
    posts: section === "blog" ? posts : undefined,
    section,
    sidebar,
    title: pageTitle ?? definition?.title ?? groupTitle,
    treePanels: treePanels?.length ? treePanels : undefined,
    wgId,
  };
}
