import { contentMediaUrl } from "./content-media-url.ts";

/** Preserve the authored encoding while giving filesystem checks one unambiguous path. */
export function publicationDocumentFilePath(url: unknown): string {
  if (
    typeof url !== "string" ||
    !/^\/(?:content-media\/)?events\//u.test(url) ||
    /[\\?#\s*]/u.test(url) ||
    /:[a-z]/iu.test(url) ||
    /%(?:2f|5c|00)/iu.test(url)
  )
    throw new Error("Unsafe document redirect path");
  if (new URL(url, "https://pkic.org").pathname !== url)
    throw new Error("Document redirects require exact encoded paths");
  const decoded = decodeURIComponent(url);
  if (
    !/\.pdf$/iu.test(decoded) ||
    /[\\?#\p{Cc}]/u.test(decoded) ||
    /%(?:2e|2f|5c|00)/iu.test(decoded) ||
    decoded
      .split("/")
      .slice(1)
      .some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Unsafe decoded document path");
  return decoded.slice(1);
}

/** Preserve the exact Hugo event-bundle directory used by original content-media URLs. */
export function publicationRepairAliasSourceRoute(sourcePath: string): string {
  const parts = sourcePath.split("/");
  if (
    parts.length < 5 ||
    parts[0] !== "content" ||
    parts[1] !== "events" ||
    !["index.md", "_index.md"].includes(parts.at(-1)!) ||
    parts.some((part) => !part || part === "." || part === ".." || /[\\?#\p{Cc}]/u.test(part))
  )
    throw new Error("Repair alias requires an exact authored event-bundle source");
  const route = contentMediaUrl(parts.slice(1, -1).join("/")).slice("/content-media".length);
  publicationDocumentFilePath(`${route}/source.pdf`);
  return route;
}
