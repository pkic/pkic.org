/**
 * Bounded square renditions of a stored headshot.
 *
 * A stored portrait is kept at upload size (about 1024px) because a profile
 * dialog and a printed badge need it. Agenda cards, speaker directories and
 * portal lists draw the same portrait at 32 to 92 CSS pixels, so they ask the
 * public headshot route for one of these widths instead. The set is closed:
 * every width is a distinct transformation, and an open `width` would let a
 * caller mint unbounded variants of one image.
 *
 * This module stays free of Zod so the public avatar can import it without
 * pulling a schema runtime into site bundles; the route contract builds its
 * query enum from the same tuple.
 */
export const HEADSHOT_VARIANT_WIDTHS = ["96", "192", "384"] as const;
export type HeadshotVariantWidth = (typeof HEADSHOT_VARIANT_WIDTHS)[number];

/** `/api/v1/users/:userId/headshots/:file`, the public address of one current portrait file. */
export const USER_HEADSHOT_PATH = /^\/api\/v1\/users\/([^/]+)\/headshots\/([^/]+)$/;

const RELATIVE_BASE = "https://headshot.invalid";

/** The address of one bounded rendition, or null when `src` is not a live headshot address. */
export function headshotVariantUrl(src: string, width: HeadshotVariantWidth): string | null {
  let url: URL;
  try {
    url = new URL(src, RELATIVE_BASE);
  } catch {
    return null;
  }
  if (!USER_HEADSHOT_PATH.test(url.pathname)) return null;
  url.searchParams.set("width", width);
  return url.origin === RELATIVE_BASE ? `${url.pathname}${url.search}` : url.toString();
}

/**
 * The `src`/`srcset` pair for a live headshot drawn as a small portrait.
 *
 * Width descriptors rather than density descriptors: surfaces resize avatars
 * from their own frame (a directory card fills its column), so the browser
 * chooses from the rendered size the caller states in `sizes`.
 */
export function headshotVariantSources(src: string): { src: string; srcSet: string } | null {
  const candidates = HEADSHOT_VARIANT_WIDTHS.map((width) => [width, headshotVariantUrl(src, width)] as const);
  if (candidates.some(([, url]) => url === null)) return null;
  return {
    src: candidates[0]![1]!,
    srcSet: candidates.map(([width, url]) => `${url} ${width}w`).join(", "),
  };
}
