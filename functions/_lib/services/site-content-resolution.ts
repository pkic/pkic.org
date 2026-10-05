import type { SiteContentPage } from "../../../assets/shared/site-content";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { siteContentLanguageForPath, siteContentLanguagePrefix } from "../../../assets/shared/site-content-language";
import type { ContentDocument } from "./site-documents";
import { loadPublishedEventFlow } from "./site-event-flows";
import { normalizeSitePath } from "./site-markdown";
import { contentCallNames, inlineMarkdownHtml } from "./site-components";

export type SiteContentMetadata = Omit<SiteContentPage, "html">;
export interface SiteContentEnumeration {
  metadata: SiteContentMetadata;
  plainMarkdown?: string;
  rawDescription?: string;
}

export function decodedPath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

type ResolvedContent =
  | { kind: "document"; route: string; document: ContentDocument; pageNumber: number }
  | { kind: "synthetic"; page: SiteContentPage }
  | { kind: "event-flow"; route: string };

/** The rendered and metadata-only loaders share route resolution and fallback precedence. */
export function createSiteContentResolution({
  documentsByRoute,
  searchPage,
  taxonomyPage,
  documentMetadata,
}: {
  documentsByRoute: ReadonlyMap<string, ContentDocument>;
  searchPage: (query: string) => SiteContentPage;
  taxonomyPage: (route: string) => SiteContentPage | null;
  documentMetadata: (document: ContentDocument, route: string, pageNumber: number) => SiteContentEnumeration;
}) {
  function resolve(pathname: string, query = ""): ResolvedContent | null {
    const route = normalizeSitePath(decodedPath(pathname));
    if (route === "/search/") return { kind: "synthetic", page: searchPage(query) };
    if (route === "/authors/") {
      const page = taxonomyPage(route);
      return page ? { kind: "synthetic", page } : null;
    }
    const prefix = siteContentLanguagePrefix(siteContentLanguageForPath(route));
    const blogPageMatch = /^\/blog\/page\/(\d+)\/$/.exec(route.slice(prefix.length));
    const pageNumber = blogPageMatch ? Number(blogPageMatch[1]) : 1;
    const document = documentsByRoute.get(blogPageMatch ? `${prefix}/blog/` : route);
    if (document) return { kind: "document", route, document, pageNumber };
    const page = taxonomyPage(route);
    return page ? { kind: "synthetic", page } : { kind: "event-flow", route };
  }
  async function enumerate(
    pathname: string,
    options: { query?: string; publication?: SitePublicationSnapshot } = {},
  ): Promise<SiteContentEnumeration | null> {
    const resolved = resolve(pathname, options.query);
    if (!resolved) return null;
    if (resolved.kind === "document") return documentMetadata(resolved.document, resolved.route, resolved.pageNumber);
    if (resolved.kind === "synthetic") {
      const { html: _html, ...metadata } = resolved.page;
      return { metadata };
    }
    const metadata = await loadPublishedEventFlow(
      resolved.route,
      options.publication,
      async (path) => (await enumerate(path, options))?.metadata ?? null,
    );
    return metadata ? { metadata } : null;
  }
  return { resolve, enumerate };
}

/** Only plain leaf prose with no unresolved renderer/publication dependencies receives a key. */
export function plainDocumentMarkdown(
  document: ContentDocument,
  metadata: SiteContentMetadata,
  rawDescription?: string,
): string | undefined {
  if (
    document.isSection ||
    metadata.blog ||
    metadata.workingGroup ||
    metadata.island ||
    metadata.listing ||
    metadata.webinarSponsor ||
    metadata.hero.imageSrc ||
    metadata.hero.sponsor ||
    metadata.route === "/events/" ||
    metadata.route === "/" ||
    [document.body, rawDescription ?? ""].some(
      (markdown) => contentCallNames(markdown).length || markdown.includes("<") || markdown.includes("!["),
    )
  )
    return undefined;
  return document.body;
}

/** Inline hero copy is rendered only where a page actually consumes it. */
export async function renderSiteContentHero(metadata: SiteContentMetadata, rawDescription?: string) {
  return rawDescription
    ? { ...metadata.hero, descriptionHtml: await inlineMarkdownHtml(rawDescription) }
    : metadata.hero;
}
