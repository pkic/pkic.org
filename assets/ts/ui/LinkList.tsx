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
 *
 * The words beside the mark name the site — "LinkedIn", "GitHub", or the bare
 * host for somewhere the table has no name for — rather than printing the
 * address. A profile link is read as "where", not as a string to transcribe,
 * and a long one wrapped over three lines is what issue #13 objected to. The
 * address stays reachable as the link's tooltip and in the status bar.
 */
import { getLinkLabel } from "../../shared/schemas/links";
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

export interface LinkListProps {
  links: readonly string[];
  /**
   * Whose links these are, folded into each link's accessible name.
   *
   * A page showing ten people's links otherwise offers ten links all named
   * "LinkedIn", which is nothing to choose between when they are read out on
   * their own. Omitted where the subject is already the page.
   */
  ownerName?: string;
}

export function LinkList({ links, ownerName }: LinkListProps) {
  if (links.length === 0) return null;

  return (
    <ul class="pk-link-list">
      {links.map((link) => (
        <li key={link}>
          <a
            class="pk-link-list__link"
            href={link}
            rel="noreferrer noopener"
            target="_blank"
            title={link}
            aria-label={ownerName ? `${ownerName} on ${getLinkLabel(link)}` : undefined}
          >
            {/* Decoration: the address beside it is the accessible name, and
                "in" announced before it would only be noise. */}
            <span class="pk-link-list__mark" aria-hidden="true">
              {linkMark(link)}
            </span>
            <span class="pk-link-list__label">{getLinkLabel(link)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
