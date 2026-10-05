/** URL of an asset copied from content into the existing public content-media tree. */
export function contentMediaUrl(contentRelativePath: string): string {
  return `/${["content-media", ...contentRelativePath.split("/")].map(encodeURIComponent).join("/")}`;
}
