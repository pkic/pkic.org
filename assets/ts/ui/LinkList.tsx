/**
 * A subject's own links, each behind a small mark.
 *
 * A profile's links are a set of destinations, not a paragraph: the reader is
 * scanning for one of them, and the mark is what makes that scan quick. The
 * mark is derived from the host rather than passed in, so a record that stores
 * a bare URL — which is all the link schema keeps — still gets one, and two
 * records never disagree about what LinkedIn looks like.
 *
 * Deliberately not icons. A glyph set would be another asset pipeline and a
 * licensing question for a set of marks that are two characters wide anyway.
 */
import "./LinkList.css";

/**
 * The two-character mark for a host.
 *
 * Matched on the registrable part rather than the whole hostname so
 * `www.linkedin.com` and `linkedin.com` mark the same. Anything unrecognized
 * gets the outbound arrow — the honest answer for a link to somewhere the
 * system knows nothing about.
 */
const HOST_MARKS: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)linkedin\.com$/i, "in"],
  [/(^|\.)github\.com$/i, "gh"],
  [/(^|\.)gitlab\.com$/i, "gl"],
  [/(^|\.)(x|twitter)\.com$/i, "x"],
  [/(^|\.)bsky\.app$/i, "bs"],
  [/(^|\.)youtube\.com$/i, "yt"],
  [/(^|\.)orcid\.org$/i, "id"],
];

/** A Mastodon instance announces itself in the path, not the host. */
const MASTODON_PATH = /^\/@[^/]+\/?$/;

export function linkMark(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "↗";
  }
  if (parsed.protocol === "mailto:") return "@";
  if (MASTODON_PATH.test(parsed.pathname)) return "@";
  for (const [pattern, mark] of HOST_MARKS) {
    if (pattern.test(parsed.hostname)) return mark;
  }
  return "↗";
}

/** What the reader sees: the address without the scheme it never types. */
export function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export interface LinkListProps {
  links: readonly string[];
}

export function LinkList({ links }: LinkListProps) {
  if (links.length === 0) return null;

  return (
    <ul class="pk-link-list">
      {links.map((link) => (
        <li key={link}>
          <a class="pk-link-list__link" href={link} rel="noreferrer noopener" target="_blank">
            {/* Decoration: the address beside it is the accessible name, and
                "in" announced before it would only be noise. */}
            <span class="pk-link-list__mark" aria-hidden="true">
              {linkMark(link)}
            </span>
            <span class="pk-link-list__label">{linkLabel(link)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
