import { z } from "zod";
import { parse as parseYaml } from "yaml";
import modelVersionsSource from "../../../data/pkimm-versions.yaml?raw";
import type { SiteListingItem, SiteWorkingGroupSection } from "../../../assets/shared/site-content";
import type { ContentDocument } from "./site-documents";
import { createSidebar, pathSlug } from "./site-sidebar";
import { workingGroupSection } from "./site-working-groups";

/**
 * Resolves the working-group chrome a page under `/wg/` renders with.
 *
 * Three kinds of page share it. A group's `_index.md` is its "about" section;
 * the five pages the content adapter generates name their own section; and
 * everything else the group authors — a charter, a deliverable, the pages
 * below one — is a "content" page, which Hugo rendered through
 * `partials/wg/sub-navigation.html`. That third kind had no equivalent here,
 * so around fifty pages fell back to the generic article layout and lost the
 * group's header, its section nav and its side menu.
 */
export interface WorkingGroupPagesSource {
  datedDocuments: () => ContentDocument[];
  documents: readonly ContentDocument[];
  isPublished: (document: ContentDocument) => boolean;
  listingItem: (document: ContentDocument) => SiteListingItem;
  titleFor: (document: ContentDocument) => string;
}

const modelVersions = z
  .object({
    versions: z.array(
      z.object({ id: z.string(), label: z.string(), path: z.string(), isLatestRelease: z.boolean().default(false) }),
    ),
  })
  .parse(parseYaml(modelVersionsSource)).versions;

export function createWorkingGroupPages(source: WorkingGroupPagesSource) {
  const { datedDocuments, documents, isPublished, listingItem, titleFor } = source;
  const label = (document: ContentDocument) => document.data.linkTitle ?? document.data.title ?? titleFor(document);
  const sidebar = createSidebar({ documents, isPublished, label });
  const byRoute = new Map(documents.map((document) => [document.route, document]));

  /** The nearest ancestor that declares a `wgID`. */
  function groupFor(document: ContentDocument): ContentDocument | undefined {
    if (document.data.wgID) return document;
    return documents.find(
      (candidate) =>
        candidate.isSection && candidate.data.wgID && document.nodePath.startsWith(`${candidate.nodePath}/`),
    );
  }

  /** The group's own child pages, which give the nav its charter and conferences tabs. */
  function childrenOf(group: ContentDocument) {
    return documents
      .filter(
        (candidate) =>
          candidate !== group &&
          candidate.language === group.language &&
          candidate.nodePath.startsWith(`${group.nodePath}/`) &&
          candidate.nodePath.slice(group.nodePath.length + 1).split("/").length === 1 &&
          typeof candidate.data.params?.wgSection !== "string" &&
          isPublished(candidate),
      )
      .sort((a, b) => (a.data.weight ?? 0) - (b.data.weight ?? 0) || titleFor(a).localeCompare(titleFor(b)))
      .map((candidate) => ({
        href: candidate.route,
        label: label(candidate),
        slug: candidate.nodePath.slice(group.nodePath.length + 1),
      }));
  }

  /** A deliverable earns a chevron when its own section has pages under it. */
  function deliverableSection(url: string): ContentDocument | undefined {
    const document = byRoute.get(url);
    return document && sidebar.childrenOf(document).length ? document : undefined;
  }

  /**
   * The panels the section nav's chevrons open.
   *
   * A panel reads from the current page when the reader is inside that
   * deliverable, so their own branch is open, and from the deliverable itself
   * everywhere else.
   */
  function treePanelsFor(group: ContentDocument, page: ContentDocument) {
    return (group.data.deliverables ?? []).flatMap((entry) => {
      const url = entry.url ?? "";
      if (!url.startsWith(group.route)) return [];
      const section = deliverableSection(url);
      if (!section) return [];
      const inside = page.route.startsWith(url);
      const currentVersion = modelVersions.find((version) => page.route.startsWith(version.path));
      const subPath = currentVersion ? page.route.slice(currentVersion.path.length) : "";
      const versions = modelVersions.some((version) => version.path === url)
        ? modelVersions.map((version) => {
            const candidate = `${version.path}${subPath}`;
            const equivalent = byRoute.get(candidate);
            const exists = Boolean(equivalent && isPublished(equivalent));
            return {
              id: version.id,
              label: version.label,
              href: exists ? candidate : version.path,
              current: version.id === currentVersion?.id,
              latest: version.isLatestRelease,
              fallback: Boolean(subPath && !exists),
            };
          })
        : undefined;
      return [
        { id: `wg-nav-tree-${pathSlug(url)}`, tree: sidebar.sidebarTree(section, inside ? page : section), versions },
      ];
    });
  }

  /**
   * Every conference on the site, split at today.
   *
   * `wg-sub.html` reads `eventType: conference` across the whole catalog
   * rather than the group's own pages, and orders each band newest first.
   */
  function conferenceBands() {
    const today = new Date().toISOString().slice(0, 10);
    const eventDate = (page: ContentDocument) =>
      String(page.data.params?.eventDate ?? page.data.eventDate ?? "").slice(0, 10);
    // A conference without a date belongs in neither band.
    const conferences = documents
      .filter(
        (page) =>
          (page.data.params?.eventType ?? page.data.eventType) === "conference" && isPublished(page) && eventDate(page),
      )
      .sort((a, b) => eventDate(b).localeCompare(eventDate(a)));
    return {
      past: conferences.filter((page) => eventDate(page) < today).map(listingItem),
      upcoming: conferences.filter((page) => eventDate(page) >= today).map(listingItem),
    };
  }

  /** The crumbs between the group and a page it authors itself. */
  function breadcrumbTrail(group: ContentDocument, page: ContentDocument) {
    const parts = page.nodePath
      .slice(group.nodePath.length + 1)
      .split("/")
      .slice(0, -1);
    return parts.flatMap((_part, index) => {
      const nodePath = `${group.nodePath}/${parts.slice(0, index + 1).join("/")}`;
      const ancestor = documents.find((candidate) => candidate.nodePath === nodePath);
      return ancestor ? [{ href: ancestor.route, label: label(ancestor) }] : [];
    });
  }

  return function workingGroupSectionFor(document: ContentDocument): SiteWorkingGroupSection | undefined {
    const group = groupFor(document);
    if (!group || group.nodePath.split("/").length !== 2) return undefined;
    // A group's own index is its "about" section; a generated page names its
    // own; anything else is a page the group wrote.
    // `wgSection` is ordinary front matter, so it can be written at the top
    // level (the conferences page does) or under `params` (the generated
    // pages do). Hugo reads both through `.Params`.
    const generated = document.data.params?.wgSection ?? document.data.wgSection;
    const section = document.data.wgID ? "about" : typeof generated === "string" ? generated : "content";
    const wgId = String(group.data.wgID).toUpperCase();
    const isContent = section === "content";
    const root = isContent ? sidebar.sidebarRootFor(document, group) : undefined;
    return workingGroupSection({
      base: group.route,
      breadcrumbTrail: isContent ? breadcrumbTrail(group, document) : undefined,
      children: childrenOf(group),
      data: group.data,
      deliverableHasChildren: (url) => Boolean(deliverableSection(url)),
      description: isContent ? document.data.description : undefined,
      groupTitle: group.data.title ?? titleFor(group),
      pageTitle: isContent ? label(document) : undefined,
      posts: datedDocuments()
        .filter((post) => (post.data.tags ?? []).some((tag) => tag.toUpperCase() === wgId))
        .slice(0, 6)
        .map(listingItem),
      conferences: section === "conferences" ? conferenceBands() : undefined,
      route: document.route,
      section: section as SiteWorkingGroupSection["section"],
      sidebar: isContent && root && sidebar.hasSideMenu(document) ? sidebar.sidebarTree(root, document) : undefined,
      treePanels: treePanelsFor(group, document),
      wgId,
    });
  };
}
