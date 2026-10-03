import { siteContentLanguageForPath, siteContentLanguagePrefix } from "./site-content-language";

/** Preserve Hugo's feed prefix while keeping paginated archives on one feed. */
export function siteTaxonomyFeedHref(path: string): string | undefined {
  const prefix = siteContentLanguagePrefix(siteContentLanguageForPath(path));
  const match = /^\/(authors|tags|series)\/(?:(.+?)\/)?(?:page\/\d+\/)?$/.exec(path.slice(prefix.length));
  if (!match) return undefined;
  return `${prefix}/feed/${match[1]}/${match[2] ? `${match[2]}/` : ""}index.xml`;
}
