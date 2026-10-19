/**
 * A link that opens away from the page says so in words, for a reader who
 * cannot see the layout. One phrase for every such link.
 */
export const NEW_TAB_HINT = "(opens in a new tab)";

/** The attributes of a link that opens in a new tab without handing it this page. */
export const NEW_TAB_ATTRIBUTES = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * Whether a destination leaves the portal: an absolute http(s) address on
 * another origin. Relative, hash, same-origin, mailto: and tel: links stay
 * here and open in place.
 */
export function isExternalHref(
  href: string | null | undefined,
  origin: string = globalThis.location?.origin ?? "",
): boolean {
  const value = href?.trim();
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).origin !== origin;
  } catch {
    return false;
  }
}
