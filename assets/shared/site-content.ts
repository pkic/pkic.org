import type { PortalLoginCopy } from "./schemas/portal-login-copy";
import type { PublicSponsor } from "./schemas/public-sponsors";
import type { SiteContentLanguage } from "./site-content-language";
/**
 * A person in a page's byline, as the page itself records them.
 *
 * The affiliation is the one the author held when the page was published —
 * snapshotted into its `authorProfiles` front matter — not whatever the member
 * directory says today.
 */
export interface SiteAuthor {
  archiveHref?: string;
  headshot?: string;
  /** Profile URLs, named and marked by the shared link list. */
  links?: string[];
  name: string;
  organization?: { logo?: string; name?: string; website?: string };
  role?: string;
}

/** What a blog post's sidebar shows beside the article. */
export interface SiteBlogSidebar {
  language?: SiteContentLanguage;
  authors: SiteAuthor[];
  next?: { href: string; title: string };
  previous?: { href: string; title: string };
  readingTime: number;
  related: SiteListingItem[];
  tags: string[];
}

export interface SiteListingItem {
  /** The byline, in the order the page names its authors. */
  authors?: SiteAuthor[];
  date?: string;
  duration?: number;
  href: string;
  links?: Array<{ label: string; tone?: string; href: string }>;
  imageSrc?: string;
  /** The call to action an event card carries, such as a webinar's registration. */
  button?: { href: string; label: string };
  /** An event's venue line, which its card shows in place of the date. */
  location?: string;
  summary?: string;
  tag?: string;
  /** Every topic the page is filed under, which a list line shows as badges. */
  tags?: string[];
  theme?: string;
  title: string;
}

export interface SiteListing {
  basePath?: string;
  heading: string;
  /** Name the section for assistive technology without drawing the heading. */
  headingHidden?: boolean;
  items: SiteListingItem[];
  kind?: "blog" | "cards" | "events" | "subpages" | "working-groups";
  /**
   * Where the list sits, which decides its wrapper.
   *
   * `band` is a named section on the home page, with its own heading row and
   * a link to the full list; `page` is a list page's own body, which carries
   * the pager and no band heading; `inline` is a section's children under its
   * prose, which carries neither.
   */
  layout?: "band" | "inline" | "page";
  /** A closing note under the grid, as `note` front matter writes it. */
  note?: string;
  page: number;
  pageCount: number;
}

export type SiteHeroTone =
  | "about"
  | "blog"
  | "blue"
  | "default"
  | "events"
  | "green"
  | "members"
  | "orange"
  | "purple"
  | "resources"
  | "teal"
  | "working-groups";

export interface SiteHero {
  imageSize?: "default" | "tall" | "full";
  button?: { href: string; label: string };
  /** A working group's glyph and slug, for the hero's watermark and accent. */
  icon?: string;
  wgId?: string;
  description?: string;
  /** The hero copy as inline HTML: Hugo rendered `heroDescription` as Markdown. */
  descriptionHtml?: string;
  eyebrow?: string;
  imageAlt?: string;
  imageSrc?: string;
  sponsor?: {
    publishedSponsors?: PublicSponsor[];
    eventName?: string;
    eventSlug?: string;
    minimumWeight: number;
  };
  title: string;
  tone: SiteHeroTone;
}

export interface SiteSectionNavigation {
  currentPath: string;
  items: Array<{ href: string; label: string }>;
}

export interface SitePageMeta {
  authors?: string[];
  /** The authors resolved to their headshot and profile, in the order given. */
  authorProfiles?: SiteAuthor[];
  date?: string;
  tags?: string[];
}

export interface SiteHomeContent {
  featuredPost?: SiteListingItem;
  /** The hero's own buttons, as `heroLinks` front matter writes them. */
  heroLinks?: Array<{ href: string; label: string; primary?: boolean }>;
  memberCount?: number;
  recentPosts: SiteListingItem[];
  upcomingEvent?: SiteListingItem;
  /** How many events are still to come, which the hero counts down from. */
  upcomingEventCount?: number;
  workingGroups: SiteListingItem[];
}

/**
 * The sections a working group publishes.
 *
 * The first five are generated from the group's own front matter by the
 * content adapter. `conferences` is not: a group that wants one writes the
 * page itself with `layout: wg-sub`, and only PQC has.
 */
export type SiteWorkingGroupSectionKey = "blog" | "conferences" | "deliverables" | "focus" | "members" | "resources";

/** One card in a working-group section: a focus area, a deliverable, a resource. */
export interface SiteWorkingGroupCard {
  description?: string;
  external?: boolean;
  href?: string;
  icon?: string;
  status?: string;
  title: string;
}

/**
 * A working-group sub-page, built from the group's own front matter.
 *
 * Hugo generated these pages from `content/wg/_content.gotmpl` and rendered
 * them from `wg-sub.html`, so the group index stays the single place the
 * focus areas, deliverables and resources are written down.
 */
/** A headline deliverable, rendered as its own card on the group's landing page. */
export interface SiteWorkingGroupKeyDeliverable {
  badge?: string;
  cta?: string;
  description?: string;
  href?: string;
  icon?: string;
  title: string;
}

/** One card in the landing page's "Explore this Working Group" grid. */
export interface SiteWorkingGroupExploreCard {
  count: string;
  href: string;
  icon: string;
  title: string;
}

/**
 * One row of a working group's section tree.
 *
 * A node with children is a disclosure; `open` is set when the current page
 * lives inside it, so the reader's own branch is already unfolded on arrival.
 */
export interface SiteSidebarNode {
  children?: SiteSidebarNode[];
  current: boolean;
  href: string;
  label: string;
  open?: boolean;
}

export interface SiteSidebarTree {
  /** Children lifted out of a section that hides itself from the tree. */
  promoted?: SiteSidebarNode[];
  root: { current: boolean; href: string; label: string };
  sections: SiteSidebarNode[];
}

export interface SiteWorkingGroupSection {
  accent: string;
  base: string;
  breadcrumb: Array<{ href: string; label: string }>;
  cards: SiteWorkingGroupCard[];
  /** The conferences section's two bands, newest first within each. */
  conferences?: { past: SiteListingItem[]; upcoming: SiteListingItem[] };
  /** The page's own standfirst, under the sub-page title. */
  description?: string;
  /** Set on the group's landing page rather than one of its sections. */
  explore?: SiteWorkingGroupExploreCard[];
  groupTitle: string;
  heading: string;
  introHtml?: string;
  join?: { href: string; label: string };
  keyDeliverables?: SiteWorkingGroupKeyDeliverable[];
  lead: string;
  nav: Array<{
    current: boolean;
    href: string;
    label: string;
    /** The tree panel this entry's chevron opens. */
    panel?: string;
    /** The in-page section the scroll spy tracks for this entry. */
    target?: string;
  }>;
  posts?: SiteListingItem[];
  /** "content" is a page the group authors itself rather than a generated section. */
  section: SiteWorkingGroupSectionKey | "about" | "content";
  /** The sticky aside, on pages that ask for a side menu. */
  sidebar?: SiteSidebarTree;
  title: string;
  /** The panels the section nav's chevrons open, one per deliverable branch. */
  treePanels?: Array<{
    id: string;
    tree: SiteSidebarTree;
    versions?: Array<{ id: string; label: string; href: string; current: boolean; latest: boolean; fallback: boolean }>;
  }>;
  wgId: string;
}

export interface SiteNavigationItem {
  /** Working-group metadata, for the mega menu's cards. */
  card?: { color?: string; description?: string; icon?: string; title?: string; wgId?: string };
  children: SiteNavigationItem[];
  external?: boolean;
  href?: string;
  identifier: string;
  label: string;
}

export interface SiteNavigation {
  footer: SiteNavigationItem[];
  main: SiteNavigationItem[];
}

/**
 * A page as the renderer receives it.
 *
 * Shared rather than owned by the content service so the taxonomy module can
 * return one without importing the service that calls it.
 */
/** The events index: consortium events by year, with webinars beside them. */
export interface SiteEventsIndex {
  /** The sidebar's own copy, from the `events-sidebar` block in the page body. */
  sidebar?: { cta?: string; ctaLabel?: string; ctaLink?: string; description?: string; title?: string };
  past: Array<{ events: SiteListingItem[]; year: string }>;
  upcoming: Array<{ events: SiteListingItem[]; year: string }>;
  webinars: { past: SiteListingItem[]; upcoming: SiteListingItem[] };
}

/**
 * A tag, author or series page.
 *
 * The index lists the terms with a count; a term lists the pages filed under
 * it, ten to a page, the way `_default/taxonomy.html` does.
 */
export interface SiteTaxonomy {
  basePath: string;
  heading: string;
  page: number;
  pageCount: number;
  plural: string;
  posts?: SiteListingItem[];
  singular: string;
  term?: string;
  terms?: Array<{ count: number; href: string; label: string }>;
}

export interface SiteContentPage {
  webinarSponsor?: { name: string; logoSrc?: string };
  /** An authored social visual, resolved through the same page asset reader. */
  socialCard?: { variant?: "webinar"; imageSrc?: string; imageRound?: boolean; sponsorSlug?: string };
  /** Authored copy for the full-width portal sign-in shell. */
  portalLogin?: PortalLoginCopy;
  /** Set on `/events/`, which lists the consortium's events by year. */
  events?: SiteEventsIndex;
  /** A blog post's sidebar and the posts either side of it. */
  blog?: SiteBlogSidebar;
  description?: string;
  /** `fullwidth` front matter: the page reads in the wide container. */
  fullwidth?: boolean;
  /**
   * A whole-page client island, rendered beside the prose rather than inside
   * it: the member directory and the portal own the page's full measure, and
   * the reading column would clamp them to its own.
   */
  island?: string;
  /** The accent pair every heading and call to action on this page reads. */
  pageAccent?: string;
  workingGroup?: SiteWorkingGroupSection;
  draft: boolean;
  keywords?: string[];
  lastModified?: string;
  hero: SiteHero;
  home?: SiteHomeContent;
  html: string;
  listing?: SiteListing;
  meta?: SitePageMeta;
  redirect?: string;
  robots?: string;
  route: string;
  sectionNavigation?: SiteSectionNavigation;
  /** Set on a tag, author or series page instead of `listing`. */
  taxonomy?: SiteTaxonomy;
  title: string;
}
export interface SiteMapEntry {
  lastModified?: string;
  route: string;
}
