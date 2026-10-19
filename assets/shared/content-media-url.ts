/** URL of an asset copied from content into the existing public content-media tree. */
export function contentMediaUrl(contentRelativePath: string): string {
  return `/${["content-media", ...contentRelativePath.split("/")].map(encodeURIComponent).join("/")}`;
}

/** Resolve authored bundle paths only when the published asset inventory confirms them. */
export function resolveContentMediaUrl(url: string, paths: ReadonlySet<string>): string {
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  const suffixAt = url.search(/[?#]/u);
  const pathname = suffixAt < 0 ? url : url.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? "" : url.slice(suffixAt);
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(1));
  } catch {
    return url;
  }
  return paths.has(relativePath) ? `${contentMediaUrl(relativePath)}${suffix}` : url;
}
