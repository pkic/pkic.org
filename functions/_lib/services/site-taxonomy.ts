import type { SiteContentPage, SiteListingItem } from "../../../assets/shared/site-content";
import type { ContentDocument } from "./site-documents";
import { slugify } from "./site-markdown";
import {
  siteContentLanguageForPath,
  siteContentLanguagePrefix,
  type SiteContentLanguage,
} from "../../../assets/shared/site-content-language";

/**
 * Tags, authors and series over the published catalog.
 *
 * Hugo classified every page, not only blog posts, and a term's page lists
 * them newest first. The context is passed in so this module knows about
 * documents without knowing about the service that reads them.
 */
export interface TaxonomyContext {
  documents: readonly ContentDocument[];
  isPublished: (document: ContentDocument) => boolean;
  listingItem: (document: ContentDocument) => SiteListingItem;
}

export type TaxonomyName = "authors" | "series" | "tags";

export interface TaxonomyEntry {
  posts: ContentDocument[];
  route: string;
  title: string;
}

function taxonomyTitle(taxonomy: TaxonomyName): string {
  return taxonomy[0]!.toUpperCase() + taxonomy.slice(1);
}

export interface TaxonomyTerm {
  label: string;
  posts: ContentDocument[];
}

export function createSiteTaxonomy({ documents, isPublished, listingItem }: TaxonomyContext) {
  function taxonomyMap(taxonomy: TaxonomyName, language: SiteContentLanguage = "en"): Map<string, TaxonomyTerm> {
    const values = new Map<string, TaxonomyTerm>();
    const classified = documents
      .filter((document) => document.language === language && isPublished(document) && document.data[taxonomy]?.length)
      .sort((a, b) => String(b.data.date ?? "").localeCompare(String(a.data.date ?? "")));
    for (const page of classified) {
      for (const label of page.data[taxonomy] ?? []) {
        const key = slugify(label);
        const value = values.get(key) ?? { label, posts: [] };
        value.posts.push(page);
        values.set(key, value);
      }
    }
    return values;
  }

  /** Hugo's own singulars, from the `taxonomies` map in the site config. */
  const SINGULAR: Record<TaxonomyName, string> = { authors: "author", series: "series", tags: "tag" };
  const HEADING = "PKI Consortium blog";
  const PER_PAGE = 10;

  function taxonomyPage(route: string): SiteContentPage | null {
    const language = siteContentLanguageForPath(route);
    const prefix = siteContentLanguagePrefix(language);
    const match = /^\/(authors|tags|series)\/(?:(.+?)\/)?(?:page\/(\d+)\/)?$/.exec(route.slice(prefix.length));
    if (!match) return null;
    const taxonomy = match[1] as TaxonomyName;
    const termSlug = match[2];
    const page = match[3] ? Number(match[3]) : 1;
    const values = taxonomyMap(taxonomy, language);
    const title = taxonomyTitle(taxonomy);

    if (!termSlug) {
      // The index lists its terms by how many pages carry them, which is what
      // `.Data.Terms.ByCount` gives the published page.
      const terms = [...values.entries()]
        .sort((a, b) => b[1].posts.length - a[1].posts.length || a[1].label.localeCompare(b[1].label))
        .map(([key, value]) => ({
          count: value.posts.length,
          href: `${prefix}/${taxonomy}/${key}/`,
          label: value.label,
        }));
      return {
        draft: false,
        hero: { title, tone: "blog" },
        html: "",
        pageAccent: "blue",
        route,
        taxonomy: {
          basePath: `${prefix}/${taxonomy}/`,
          heading: HEADING,
          page: 1,
          pageCount: 1,
          plural: taxonomy,
          singular: SINGULAR[taxonomy],
          terms,
        },
        title,
      };
    }

    const term = values.get(termSlug);
    if (!term) return null;
    const pageCount = Math.max(1, Math.ceil(term.posts.length / PER_PAGE));
    if (page > pageCount) return null;
    return {
      draft: false,
      hero: { title: term.label, tone: "blog" },
      html: "",
      pageAccent: "blue",
      route,
      taxonomy: {
        basePath: `${prefix}/${taxonomy}/${termSlug}/`,
        heading: HEADING,
        page,
        pageCount,
        plural: taxonomy,
        posts: term.posts.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(listingItem),
        singular: SINGULAR[taxonomy],
        term: term.label,
      },
      title: term.label,
    };
  }

  function taxonomyEntries(language: SiteContentLanguage, { paginate = true } = {}): TaxonomyEntry[] {
    const prefix = siteContentLanguagePrefix(language);
    const entries: TaxonomyEntry[] = [];
    for (const taxonomy of ["authors", "tags", "series"] as const) {
      const values = taxonomyMap(taxonomy, language);
      entries.push({
        route: `${prefix}/${taxonomy}/`,
        posts: [...values.values()].flatMap((value) => value.posts),
        title: taxonomyTitle(taxonomy),
      });
      for (const [slug, term] of values) {
        const pageCount = paginate ? Math.max(1, Math.ceil(term.posts.length / PER_PAGE)) : 1;
        for (let page = 1; page <= pageCount; page++) {
          entries.push({
            route: `${prefix}/${taxonomy}/${slug}/${page > 1 ? `page/${page}/` : ""}`,
            posts: paginate ? term.posts.slice((page - 1) * PER_PAGE, page * PER_PAGE) : term.posts,
            title: term.label,
          });
        }
      }
    }
    return entries;
  }

  return { taxonomyEntries, taxonomyPage };
}
