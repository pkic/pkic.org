declare module "virtual:pkic-bylines" {
  import type { SiteAuthor } from "./site-content";

  /** Every page's byline, keyed by `normalizedContentPath` of its source. */
  export const bylines: Readonly<Record<string, SiteAuthor[]>>;
}
