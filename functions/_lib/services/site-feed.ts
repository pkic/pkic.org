import { SITE_CONTENT_LANGUAGES, type SiteContentLanguage } from "../../../assets/shared/site-content-language";
import type { ContentDocument } from "./site-documents";
import type { TaxonomyEntry } from "./site-taxonomy";
import { siteTaxonomyFeedHref } from "../../../assets/shared/site-feed-url";

export interface SiteFeedItem {
  authors?: string[];
  date?: string;
  description?: string;
  route: string;
  title: string;
}

export interface SiteRssFeed {
  description: string;
  items: SiteFeedItem[];
  language: SiteContentLanguage;
  route: string;
  title: string;
}

/** Feed endpoints consume the same published, localized catalog as page listings. */
export function createSiteFeed({
  datedDocuments,
  plainSummary,
  titleFor,
  taxonomyEntries,
}: {
  datedDocuments: (language: SiteContentLanguage) => ContentDocument[];
  plainSummary: (document: ContentDocument) => string | undefined;
  titleFor: (document: ContentDocument) => string;
  taxonomyEntries: (language: SiteContentLanguage) => TaxonomyEntry[];
}) {
  const items = (documents: readonly ContentDocument[], limit: number): SiteFeedItem[] =>
    documents.slice(0, limit).map((document) => ({
      authors: document.data.authors,
      date: document.data.date ? String(document.data.date) : undefined,
      description: plainSummary(document),
      route: document.route,
      title: document.data.title ?? titleFor(document),
    }));

  function siteFeedItems(limit = 30, language: SiteContentLanguage = "en"): SiteFeedItem[] {
    return items(datedDocuments(language), limit);
  }

  function siteTaxonomyFeeds(): SiteRssFeed[] {
    return SITE_CONTENT_LANGUAGES.flatMap((language) => {
      return taxonomyEntries(language)
        .filter(({ route }) => !/\/page\/\d+\/$/.test(route))
        .map(({ route, posts, title }) => {
          // A taxonomy index can classify the same page under multiple terms.
          const documents = [...new Map(posts.map((document) => [document.route, document])).values()].sort((a, b) =>
            String(b.data.date ?? "").localeCompare(String(a.data.date ?? "")),
          );
          const feedRoute = siteTaxonomyFeedHref(route);
          if (!feedRoute) throw new Error(`Invalid taxonomy feed source: ${route}`);
          return {
            description: `Published PKI Consortium content about ${title}`,
            items: items(documents, 30),
            language,
            route: feedRoute,
            title: `${title} on PKI Consortium`,
          };
        });
    });
  }

  return { siteFeedItems, siteTaxonomyFeeds };
}
