/// <reference types="vite/client" />
import { readAuthoredAgendaSources } from "./site-authored-agenda-sources";

import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { parse as parseYaml } from "yaml";
import contentMediaPaths, { webinarSponsors } from "virtual:pkic-content-media";
import siteConfigSource from "../../../config.yaml?raw";
import type {
  SiteContentPage,
  SiteHomeContent,
  SiteListing,
  SiteListingItem,
  SiteNavigation,
  SiteMapEntry,
} from "../../../assets/shared/site-content";
import {
  contentPathToRoute,
  compileContentIgnorePatterns,
  contentSourceIsIncluded,
  normalizeSitePath,
  normalizedContentPath,
  parseFrontMatter,
  type MenuEntry,
} from "./site-markdown";
import {
  contentCallNames,
  contentComponentNames,
  inlineMarkdownHtml,
  renderContentMarkdown,
  stripContentComponentSyntax,
} from "./site-components";
import { contentComponentListing, inheritedEventDocument, matchingContentAssetUrls } from "./site-component-data";
import { buildSiteNavigation } from "./site-navigation";
import { createSiteTaxonomy } from "./site-taxonomy";
import { islandForRoute } from "./site-islands";
import { loadPublishedEventFlow } from "./site-event-flows";
import {
  createSiteContentResolution,
  decodedPath,
  plainDocumentMarkdown,
  renderSiteContentHero,
  type SiteContentMetadata,
} from "./site-content-resolution";
import { collectDocumentSponsorSelections } from "./site-sponsor-selections";
import { readMembershipAgreementDocuments } from "./site-membership-agreements";
import { sponsorPublicationKey } from "../../../assets/shared/sponsor-publication-query";
import { createBlogSidebar } from "./site-blog";
import { createSiteFeed } from "./site-feed";
import { createEventsIndex } from "./site-events";
import { createWorkingGroupPages } from "./site-working-group-page";
import { createSiteConferencePrograms } from "./site-conference-program-catalog";
import {
  generatedSectionDocuments,
  nodePathForSource,
  workingGroupSectionDocuments,
  type ContentDocument,
} from "./site-documents";
import { contentAssetUrl, createSitePresentation, plainText, portalLoginCopy } from "./site-presentation";
import { siteContentLanguagePrefix, type SiteContentLanguage } from "../../../assets/shared/site-content-language";

export { contentPathToRoute, normalizeSitePath, parseFrontMatter } from "./site-markdown";
export type { SiteContentPage, SiteMapEntry } from "../../../assets/shared/site-content";

export interface SiteContentOptions {
  query?: string;
  publication?: SitePublicationSnapshot;
}

const rawContentSources = import.meta.glob(
  [
    "../../../content/**/*.md",
    "!../../../content/**/.*",
    "!../../../content/**/.*/**",
    "!../../../content/**/AGENTS.md",
    "!../../../content/**/CLAUDE.md",
    "!../../../content/**/CODEX.md",
    "!../../../content/**/COPILOT.md",
    "!../../../content/**/GEMINI.md",
    "!../../../content/**/PROMPTS.md",
  ],
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
) as Readonly<Record<string, string>>;

const BLOG_PAGE_SIZE = 10;

interface SiteConfig {
  ignoreFiles?: string[];
  menu?: Partial<Record<"footer" | "main", MenuEntry[]>>;
}

const siteConfig = (parseYaml(siteConfigSource) ?? {}) as SiteConfig;
const contentIgnorePatterns = compileContentIgnorePatterns(siteConfig.ignoreFiles ?? []);

const documents: ContentDocument[] = Object.entries(rawContentSources)
  .filter(([sourcePath]) => contentSourceIsIncluded(sourcePath, contentIgnorePatterns))
  .map(([sourcePath, source]) => {
    const parsed = parseFrontMatter(source);
    const language: SiteContentLanguage = sourcePath.endsWith(".ms.md") ? "ms" : "en";
    const routeSourcePath = language === "ms" ? sourcePath.replace(/\.ms\.md$/, ".md") : sourcePath;
    const baseRoute = contentPathToRoute(routeSourcePath, parsed.data);
    return {
      ...parsed,
      isSection: routeSourcePath.endsWith("/_index.md") || routeSourcePath.endsWith("content/_index.md"),
      language,
      nodePath: nodePathForSource(routeSourcePath),
      route: normalizeSitePath(`${siteContentLanguagePrefix(language)}${baseRoute}`),
      sourcePath,
    };
  })
  .filter((document) => document.data.build?.render !== "never");

documents.push(...generatedSectionDocuments(documents));
documents.push(...workingGroupSectionDocuments(documents));

const documentsByRoute = new Map(documents.map((document) => [document.route, document]));

export const siteAuthoredAgendaSources = () => readAuthoredAgendaSources(documents);

export const siteConferencePrograms = createSiteConferencePrograms(documents, (sourcePath, pattern) =>
  matchingContentAssetUrls(sourcePath, contentMediaPaths, pattern),
);
const {
  descriptionFor,
  heroFor,
  socialCardFor,
  listingItem,
  pageAccentFor,
  plainSummary,
  rawDescriptionFor,
  sectionNavigationFor,
  titleFor,
} = createSitePresentation(documents);

const { taxonomyEntries, taxonomyPage } = createSiteTaxonomy({
  documents,
  isPublished: (document) => isPublished(document),
  listingItem: (document) => listingItem(document),
});

const aliasTargets = new Map<string, string>();
const aliasPriorities = new Map<string, string>();
for (const document of documents) {
  const aliases = Array.isArray(document.data.aliases)
    ? document.data.aliases
    : document.data.aliases
      ? [document.data.aliases]
      : [];
  for (const configuredAlias of aliases) {
    const alias = normalizeSitePath(configuredAlias.startsWith("/") ? configuredAlias : `/${configuredAlias}`);
    if (alias === document.route) continue;
    const priority = `${String(document.data.date ?? document.data.lastmod ?? "")}\u0000${document.route}`;
    if (!aliasPriorities.has(alias) || priority > aliasPriorities.get(alias)!) {
      aliasPriorities.set(alias, priority);
      aliasTargets.set(alias, document.route);
    }
  }
}

function childDocuments(parent: ContentDocument): ContentDocument[] {
  if (!parent.isSection) return [];
  const prefix = parent.nodePath ? `${parent.nodePath}/` : "";
  return documents.filter((candidate) => {
    if (candidate === parent || candidate.data.draft === true || !candidate.nodePath.startsWith(prefix)) return false;
    if (candidate.language !== parent.language) return false;
    if (candidate.route.startsWith("/_event-flow-shells/")) return false;
    return !documents.some(
      (possibleParent) =>
        possibleParent !== parent &&
        possibleParent !== candidate &&
        possibleParent.nodePath.startsWith(prefix) &&
        candidate.nodePath.startsWith(`${possibleParent.nodePath}/`),
    );
  });
}

function datedDocuments(language: SiteContentLanguage = "en"): ContentDocument[] {
  return documents
    .filter(
      (document) =>
        document.language === language &&
        document.sourcePath.includes("/content/blog/") &&
        !document.isSection &&
        !document.data.draft,
    )
    .sort((a, b) => String(b.data.date ?? "").localeCompare(String(a.data.date ?? "")));
}

function isPublished(document: ContentDocument): boolean {
  return document.data.draft !== true && !document.route.startsWith("/_event-flow-shells/");
}

function isIndexable(document: ContentDocument): boolean {
  return (
    isPublished(document) &&
    !document.data.redirect &&
    !/(?:^|,)\s*noindex\b/i.test(document.data.robots ?? "") &&
    document.data.sitemap?.disable !== true
  );
}

export function siteNavigation(): SiteNavigation {
  return buildSiteNavigation(
    siteConfig.menu ?? {},
    documents.map((document) => ({
      card: document.data.wgID
        ? {
            color: document.data.color,
            description: document.data.description,
            icon: document.data.card?.icon ?? String(document.data.wgID).toLowerCase(),
            title: document.data.title ?? titleFor(document),
            wgId: String(document.data.wgID).toUpperCase(),
          }
        : undefined,
      menu: document.data.menu,
      published: isPublished(document),
      route: document.route,
      title: document.data.title ?? titleFor(document),
    })),
  );
}

function pagedListing(items: SiteListingItem[], heading: string, basePath: string, page: number): SiteListing {
  const pageCount = Math.max(1, Math.ceil(items.length / BLOG_PAGE_SIZE));
  const validPage = Math.min(Math.max(page, 1), pageCount);
  const start = (validPage - 1) * BLOG_PAGE_SIZE;
  return { basePath, heading, items: items.slice(start, start + BLOG_PAGE_SIZE), page: validPage, pageCount };
}

function sectionListing(document: ContentDocument, page: number): SiteListing | undefined {
  if (document.isSection && document.nodePath === "blog") {
    // The index is the posts; the published page carries no band heading over
    // them, so the listing's own name is for assistive technology only.
    return {
      ...pagedListing(datedDocuments(document.language).map(listingItem), "Latest posts", document.route, page),
      headingHidden: true,
      kind: "blog",
      layout: "page",
    };
  }
  if (document.route === "/events/webinars/") {
    const webinars = documents
      .filter((candidate) => candidate.data.layout === "webinar" && candidate.data.draft !== true)
      .sort((a, b) => String(b.data.date ?? "").localeCompare(String(a.data.date ?? "")));
    return { heading: "Webinars", items: webinars.map(listingItem), kind: "cards", page: 1, pageCount: 1 };
  }
  if (document.route.endsWith("/conferences/")) {
    const conferences = documents
      .filter(
        (candidate) =>
          candidate.sourcePath.includes("/content/events/") &&
          /(?:post-quantum|pqc).+conference/i.test(candidate.data.title ?? "") &&
          candidate.data.draft !== true,
      )
      .sort((a, b) => String(b.data.date ?? "").localeCompare(String(a.data.date ?? "")));
    return {
      heading: "PQC conferences",
      items: conferences.map(listingItem),
      kind: "cards",
      page: 1,
      pageCount: 1,
    };
  }
  if (document.route === "/wg/") {
    return {
      heading: "Working groups",
      items: childDocuments(document).map(listingItem),
      kind: "working-groups",
      layout: "inline",
      page: 1,
      pageCount: 1,
    };
  }
  /*
   * `_default/section.html` lists a section's own pages under its body, and
   * nothing else: a page that is not a section has no list, a section that
   * sets `noPages` has none either, and the child sections are reached from
   * the body rather than from the grid. Listing everything from every page is
   * what put a card grid under `/about/` and `/donate/`, which publish none.
   */
  if (!document.isSection || document.data.noPages) return undefined;
  const children = childDocuments(document)
    .filter((child) => !child.isSection && !child.data.robots)
    .sort((a, b) => titleFor(a).localeCompare(titleFor(b)));
  return children.length
    ? {
        heading: "Explore this section",
        headingHidden: true,
        items: children.map(listingItem),
        kind: "subpages",
        layout: "inline",
        note: document.data.note,
        page: 1,
        pageCount: 1,
      }
    : undefined;
}

function homeContent(language: SiteContentLanguage = "en"): SiteHomeContent {
  const posts = datedDocuments(language);
  const today = new Date().toISOString().slice(0, 10);
  const eventDate = (document: ContentDocument): string =>
    String(document.data.params?.eventDate ?? document.data.eventDate ?? "");
  const upcomingEvents = documents
    .filter((document) => document.data.draft !== true && eventDate(document) >= today)
    .sort((a, b) => eventDate(a).localeCompare(eventDate(b)));
  const [upcomingEvent] = upcomingEvents;
  const workingGroups = documents
    .filter(
      (document) =>
        document.isSection && document.nodePath.split("/").length === 2 && document.nodePath.startsWith("wg/"),
    )
    .sort((a, b) => titleFor(a).localeCompare(titleFor(b)));
  const home = documentsByRoute.get(`${siteContentLanguagePrefix(language)}/`) ?? documentsByRoute.get("/");
  return {
    featuredPost: posts[0] ? listingItem(posts[0]) : undefined,
    heroLinks: (home?.data.heroLinks ?? [])
      .filter((link) => link.text && link.url)
      .map((link) => ({ href: link.url!, label: link.text!, primary: link.primary })),
    recentPosts: posts.slice(0, 3).map(listingItem),
    upcomingEvent: upcomingEvent ? { ...listingItem(upcomingEvent), date: eventDate(upcomingEvent) } : undefined,
    upcomingEventCount: upcomingEvents.length,
    workingGroups: workingGroups.map(listingItem),
  };
}

const blogSidebarFor = createBlogSidebar({ datedDocuments, listingItem, plainText, titleFor });

const eventsIndex = createEventsIndex({ documents, inlineMarkdownHtml, listingItem, parseYaml });

const workingGroupSectionFor = createWorkingGroupPages({
  datedDocuments,
  documents,
  isPublished,
  listingItem,
  titleFor,
});

function searchPage(query: string): SiteContentPage {
  const terms = plainText(query)
    .toLowerCase()
    .split(" ")
    .filter((term) => term.length > 1);
  const matches = terms.length
    ? documents
        .filter(isIndexable)
        .filter((document) => {
          const haystack = plainText(
            `${document.data.title ?? ""} ${descriptionFor(document) ?? ""} ${stripContentComponentSyntax(document.body)}`,
          ).toLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
        .slice(0, 48)
        .map(listingItem)
    : [];
  return {
    description: "Search public PKI Consortium pages, articles, events, and working-group material.",
    draft: false,
    hero: {
      description: "Search public PKI Consortium pages, articles, events, and working-group material.",
      title: "Search",
      tone: "default",
    },
    html: terms.length ? "" : "<p>Use the search field in the navigation bar to find public site content.</p>",
    listing: terms.length
      ? {
          heading: `Search results for “${query.trim()}”`,
          items: matches,
          kind: "cards",
          page: 1,
          pageCount: 1,
        }
      : undefined,
    robots: "noindex, follow",
    route: "/search/",
    title: "Search",
  };
}

/**
 * The working-group payload, with the group's own intro rendered.
 *
 * On a group's landing page the Markdown body and the `intro` front matter are
 * the page's opening column, so they travel with the section rather than
 * through the generic prose slot.
 */
async function workingGroupPayload(document: ContentDocument, renderedHtml: string) {
  const section = workingGroupSectionFor(document);
  if (!section || section.section !== "about") return section;
  const intro = document.data.intro ? await inlineMarkdownHtml(String(document.data.intro)) : "";
  const introHtml = `${intro ? `<p>${intro}</p>` : ""}${renderedHtml}`.trim();
  return introHtml ? { ...section, introHtml } : section;
}

function documentMetadata(document: ContentDocument, route: string, pageNumber: number) {
  const metadata: SiteContentMetadata = {
    title: document.data.title ?? titleFor(document),
    webinarSponsor: webinarSponsors[normalizedContentPath(document.sourcePath)],
    socialCard: socialCardFor(document),
    description: descriptionFor(document),
    blog: blogSidebarFor(document),
    draft: document.data.draft === true,
    fullwidth: document.data.fullwidth === true,
    keywords: document.data.keywords,
    pageAccent: pageAccentFor(document),
    lastModified: document.data.lastmod ? String(document.data.lastmod) : undefined,
    hero: heroFor(document),
    workingGroup: workingGroupSectionFor(document),
    island: islandForRoute(route),
    listing: sectionListing(document, pageNumber),
    meta: document.isSection
      ? undefined
      : {
          authors: document.data.authors,
          date: document.data.date ? String(document.data.date) : undefined,
          tags: document.data.tags,
        },
    redirect: document.data.redirect,
    robots: document.data.robots,
    route,
    sectionNavigation: sectionNavigationFor(document),
  };
  const rawDescription = rawDescriptionFor(document);
  return { metadata, rawDescription, plainMarkdown: plainDocumentMarkdown(document, metadata, rawDescription) };
}

const contentResolution = createSiteContentResolution({ documentsByRoute, searchPage, taxonomyPage, documentMetadata });
export const loadSiteContentMetadata = contentResolution.enumerate;

export async function loadSiteContent(
  pathname: string,
  options: SiteContentOptions = {},
): Promise<SiteContentPage | null> {
  const resolved = contentResolution.resolve(pathname, options.query);
  if (!resolved) return null;
  if (resolved.kind === "synthetic") return resolved.page;
  if (resolved.kind === "event-flow")
    return loadPublishedEventFlow(resolved.route, options.publication, (path) => loadSiteContent(path, options));
  const { route, document, pageNumber } = resolved;
  const eventDocument = inheritedEventDocument(document, documents);
  const rendered = await renderContentMarkdown(document.body, {
    publication: options.publication,
    assetUrl: (assetName) => contentAssetUrl(document, assetName),
    assetUrls: (pattern) => matchingContentAssetUrls(document.sourcePath, contentMediaPaths, pattern),
    data: document.data,
    eventData: eventDocument?.data.data,
    eventSlug: eventDocument?.route.split("/").filter(Boolean).at(-1),
    eventRoute: eventDocument?.route,
    eventAssetUrls: (pattern) =>
      matchingContentAssetUrls(eventDocument?.sourcePath ?? document.sourcePath, contentMediaPaths, pattern),
    listing: (kind, limit) =>
      contentComponentListing(kind, documents, datedDocuments(document.language), listingItem, limit),
    membershipDocuments: () =>
      readMembershipAgreementDocuments(
        (href) => loadSiteContent(href, options),
        (href) => {
          const source = documentsByRoute.get(href);
          return source
            ? childDocuments(source)
                .sort((a, b) => Number(a.data.weight ?? 0) - Number(b.data.weight ?? 0))
                .map((child) => child.route)
            : [];
        },
      ),
    route,
    sourcePath: document.sourcePath,
  });
  const page = documentMetadata(document, route, pageNumber);
  const hero = await renderSiteContentHero(page.metadata, page.rawDescription);
  if (hero.sponsor && options.publication) {
    const groups =
      options.publication.sponsors[
        sponsorPublicationKey({
          mode: "strip",
          eventSlug: hero.sponsor.eventSlug,
          eventName: hero.sponsor.eventName,
          minWeight: String(hero.sponsor.minimumWeight),
        })
      ];
    if (!groups) throw new Error("Hero sponsor selection is missing from the publication");
    hero.sponsor.publishedSponsors = groups.flatMap((group) => group.sponsors);
  }
  return {
    ...page.metadata,
    hero,
    html: rendered,
    events: route === "/events/" ? await eventsIndex(document.body) : undefined,
    workingGroup: await workingGroupPayload(document, rendered),
    home: document.isSection && !document.nodePath ? homeContent(document.language) : undefined,
    portalLogin:
      route === "/portal/" ? portalLoginCopy(document.data.login, homeContent().workingGroups.length) : undefined,
  };
}

export function siteRedirectTarget(pathname: string): string | undefined {
  return aliasTargets.get(normalizeSitePath(decodedPath(pathname)));
}

/**
 * Whether a request path addresses site content rather than a static file.
 *
 * Hugo published titles such as `TLS 1.2` and `X.509` with the dot intact, so
 * a bare extension test would route those pages to the asset binding and lose
 * both the page and its trailing-slash redirect.
 */
export function isSiteContentPath(pathname: string): boolean {
  const decoded = decodedPath(pathname);
  const route = normalizeSitePath(decoded);
  if (documentsByRoute.has(route) || aliasTargets.has(route)) return true;
  if (route === "/search/" || /^\/blog\/page\/\d+\/$/.test(route)) return true;
  return /^\/(authors|tags|series)\//.test(route);
}

export function siteRedirectEntries(): Array<{ from: string; to: string }> {
  return [
    ...[...aliasTargets].map(([from, to]) => ({ from, to })),
    ...documents
      .filter((document) => !document.data.draft && typeof document.data.redirect === "string")
      .map((document) => ({ from: document.route, to: String(document.data.redirect) })),
  ].sort((a, b) => a.from.localeCompare(b.from));
}

export function siteContentComponentAudit(): {
  discovered: string[];
  registered: readonly string[];
  unresolved: string[];
} {
  const discovered = [...new Set(documents.flatMap((document) => contentCallNames(document.body)))].sort();
  const expressions = new Set(["param", "ref"]);
  const registered = new Set(contentComponentNames);
  return {
    discovered,
    registered: contentComponentNames,
    unresolved: discovered.filter((name) => !expressions.has(name) && !registered.has(name)),
  };
}

export function publishedSiteRoutes(): string[] {
  return [...new Set(documents.filter(isPublished).map((document) => document.route))];
}

export function siteSponsorSelections(): Array<Record<string, string>> {
  return collectDocumentSponsorSelections(documents.filter(isPublished), heroFor);
}

function latestDate(items: ContentDocument[]): string | undefined {
  return items
    .map((document) => String(document.data.lastmod ?? document.data.date ?? ""))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];
}

export function siteMapEntries(language: "all" | SiteContentLanguage = "all"): SiteMapEntry[] {
  const entries = new Map<string, SiteMapEntry>();
  for (const document of documents.filter(isIndexable)) {
    if (language !== "all" && document.language !== language) continue;
    entries.set(document.route, {
      lastModified: document.data.lastmod
        ? String(document.data.lastmod)
        : document.data.date
          ? String(document.data.date)
          : undefined,
      route: document.route,
    });
  }

  const languages = new Set(documents.filter(isIndexable).map((document) => document.language));
  for (const locale of languages) {
    if (language !== "all" && locale !== language) continue;
    const posts = datedDocuments(locale);
    const prefix = siteContentLanguagePrefix(locale);
    const blogPageCount = Math.ceil(posts.length / BLOG_PAGE_SIZE);
    for (let page = 2; page <= blogPageCount; page += 1) {
      const pagePosts = posts.slice((page - 1) * BLOG_PAGE_SIZE, page * BLOG_PAGE_SIZE);
      const route = `${prefix}/blog/page/${page}/`;
      entries.set(route, { lastModified: latestDate(pagePosts), route });
    }
    for (const entry of taxonomyEntries(locale))
      entries.set(entry.route, { lastModified: latestDate(entry.posts), route: entry.route });
  }

  return [...entries.values()].sort((a, b) => a.route.localeCompare(b.route));
}

export const { siteFeedItems, siteTaxonomyFeeds } = createSiteFeed({
  datedDocuments,
  plainSummary,
  titleFor,
  taxonomyEntries: (language) => taxonomyEntries(language, { paginate: false }),
});
