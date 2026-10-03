import type { SiteBlogSidebar, SiteListingItem } from "../../../assets/shared/site-content";
import type { ContentDocument } from "./site-documents";
import { bylineFor } from "./site-authors";

/**
 * What a blog post's sidebar shows.
 *
 * Decided while rendering the page: the byline from the post's own front
 * matter and the related posts from the catalog the renderer already holds.
 * The sponsors are the one live part — the shared sponsor display, read from
 * D1 in the reader's browser.
 */
export interface BlogSidebarSource {
  datedDocuments: (language?: ContentDocument["language"]) => ContentDocument[];
  listingItem: (document: ContentDocument) => SiteListingItem;
  plainText: (markdown: string) => string;
  titleFor: (document: ContentDocument) => string;
}

/** Hugo's reading time: words over 213 a minute, rounded up, never zero. */
function readingTime(words: number): number {
  return Math.max(1, Math.ceil(words / 213));
}

/**
 * Posts that share the most tags with this one, newest first.
 *
 * Hugo's `Related` ranks by shared keywords and returns at most five, which is
 * what the sidebar has room for.
 */
function relatedPosts(post: ContentDocument, posts: readonly ContentDocument[]): ContentDocument[] {
  const tags = new Set((post.data.tags ?? []).map((tag) => tag.toLowerCase()));
  if (!tags.size) return [];
  return posts
    .filter((candidate) => candidate !== post)
    .map((candidate) => ({
      candidate,
      shared: (candidate.data.tags ?? []).filter((tag) => tags.has(tag.toLowerCase())).length,
    }))
    .filter((entry) => entry.shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared || String(b.candidate.data.date ?? "").localeCompare(String(a.candidate.data.date ?? "")),
    )
    .slice(0, 5)
    .map((entry) => entry.candidate);
}

export function createBlogSidebar(source: BlogSidebarSource) {
  const { datedDocuments, listingItem, plainText, titleFor } = source;

  return function blogSidebarFor(document: ContentDocument): SiteBlogSidebar | undefined {
    if (document.isSection || !document.sourcePath.includes("/blog/")) return undefined;
    const posts = datedDocuments(document.language);
    const index = posts.indexOf(document);
    // The catalog is newest first, so the previous article is the next entry.
    const previous = index >= 0 ? posts[index + 1] : undefined;
    const next = index > 0 ? posts[index - 1] : undefined;
    return {
      language: document.language,
      authors: bylineFor(document),
      next: next ? { href: next.route, title: next.data.title ?? titleFor(next) } : undefined,
      previous: previous ? { href: previous.route, title: previous.data.title ?? titleFor(previous) } : undefined,
      readingTime: readingTime(plainText(document.body).split(/\s+/).filter(Boolean).length),
      related: relatedPosts(document, posts).map(listingItem),
      tags: document.data.tags ?? [],
    };
  };
}
