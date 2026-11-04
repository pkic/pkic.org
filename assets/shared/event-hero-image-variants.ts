/** Closed rendition sizes keep display transfers small and transformation counts bounded. */
export const EVENT_HERO_VARIANT_WIDTHS = ["600", "1200", "1920"] as const;
export type EventHeroVariantWidth = (typeof EVENT_HERO_VARIANT_WIDTHS)[number];

export const EVENT_HERO_IMAGE_FILE_PATTERN = /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/;
const RELATIVE_BASE = "https://event-hero.invalid";

/** Parse an uploaded hero pathname without accepting malformed slugs or asset filenames. */
export function parseEventHeroImagePath(path: string): { slug: string; file: string } | null {
  const match = /^\/api\/v1\/events\/([^/]+)\/images\/([^/]+)$/.exec(path);
  if (!match || !EVENT_HERO_IMAGE_FILE_PATTERN.test(match[2]!)) return null;
  try {
    return { slug: decodeURIComponent(match[1]!), file: match[2]! };
  } catch {
    return null;
  }
}

/** Uploaded heroes use the same responsive markup in the portal and on the website. */
export function eventHeroImageSources(src: string): { src: string; srcSet: string } | null {
  let url: URL;
  try {
    url = new URL(src, RELATIVE_BASE);
  } catch {
    return null;
  }
  if (!parseEventHeroImagePath(url.pathname)) return null;
  const candidates = EVENT_HERO_VARIANT_WIDTHS.map((width) => {
    url.searchParams.set("width", width);
    const address = url.origin === RELATIVE_BASE ? `${url.pathname}${url.search}` : url.toString();
    return { width, address };
  });
  return {
    src: candidates[0]!.address,
    srcSet: candidates.map(({ width, address }) => `${address} ${width}w`).join(", "),
  };
}
