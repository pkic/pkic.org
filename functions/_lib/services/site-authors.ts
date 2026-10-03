import { bylines } from "virtual:pkic-bylines";
import type { SiteAuthor } from "../../../assets/shared/site-content";
import type { ContentDocument } from "./site-documents";
import { normalizedContentPath } from "./site-markdown";
import { siteContentLanguagePrefix } from "../../../assets/shared/site-content-language";
import { siteContentSlug } from "../../../assets/shared/site-content-slug";

/**
 * A page's byline, as `scripts/lib/bylines.mjs` resolved it from the page's own
 * front matter. A page the build did not see keeps its authors' bare names.
 */
export function bylineFor(document: ContentDocument): SiteAuthor[] {
  return (
    bylines[normalizedContentPath(document.sourcePath)] ??
    [...new Set(document.data.authors ?? [])].map((name) => ({ name }))
  ).map((author) => ({
    ...author,
    archiveHref: `${siteContentLanguagePrefix(document.language)}/authors/${siteContentSlug(author.name)}/`,
  }));
}
