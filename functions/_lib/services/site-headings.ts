/**
 * Heading ids and their anchor links, as the published site renders them.
 *
 * Every heading gets an automatic id and a link icon hangs off levels two to
 * four. The Markdown renderer emitted bare `<h2>`s, which cost the icon and —
 * more than cosmetically — every in-page anchor the content links to: the `#references` jumps in the capability matrix, the section nav's
 * `#wg-focus`, a shared link to a heading.
 */

/** Bootstrap Icons' `link-45deg`, which is the mark the published anchor draws. */
export const ANCHOR_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-link-45deg" viewBox="0 0 16 16">\n' +
  '    <path d="M4.715 6.542L3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.001 1.001 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>\n' +
  '    <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 0 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 0 0-4.243-4.243L6.586 4.672z"/>\n' +
  "</svg>";

/**
 * Goldmark's automatic heading id: letters and digits kept as they are but
 * lowercased, spaces turned into hyphens, `-` and `_` preserved, and every
 * other character dropped without leaving a separator behind.
 */
/** HTML entities in authored heading text, so `&amp;` slugs as `&` would. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function headingAnchor(text: string): string {
  const target: string[] = [];
  for (const character of decodeEntities(text).trim()) {
    if (/[\p{L}\p{N}]/u.test(character)) target.push(character.toLowerCase());
    else if (character === "-" || character === "_") target.push(character);
    else if (/\s/u.test(character)) target.push("-");
  }
  return target.join("");
}
