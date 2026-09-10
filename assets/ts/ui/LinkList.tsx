/**
 * A subject's own links, each behind a small mark.
 *
 * A profile's links are a set of destinations, not a paragraph: the reader is
 * scanning for one of them, and the mark is what makes that scan quick. The
 * mark and the label both come from `LINK_HOSTS` — the shared reference data,
 * not a table this component keeps — so a site added once is recognized
 * everywhere, and no surface can decide on its own that one platform deserves
 * a treatment the rest do not get. That was issue #13 in both directions:
 * LinkedIn with a badge and everything else as a raw address.
 *
 * The words beside the mark name the site — "LinkedIn", "GitHub", or the bare
 * host for somewhere the table has no name for — rather than printing the
 * address. A profile link is read as "where", not as a string to transcribe,
 * and a long one wrapped over three lines is what issue #13 objected to. The
 * address stays reachable as the link's tooltip and in the status bar.
 */
import { getLinkLabel, getLinkMark } from "../../shared/schemas/links";
import "./LinkList.css";

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
  /**
   * A name for the list itself, where the surrounding heading does not already
   * give it one — a group event's links sit under a heading that names them,
   * a person's links usually do not.
   */
  label?: string;
}

/**
 * Every link here opens away from the page, and a reader who cannot see the
 * layout has no other way to know that. Said in words rather than by an icon.
 */
const NEW_TAB = "(opens in a new tab)";

export function LinkList({ links, ownerName, label }: LinkListProps) {
  if (links.length === 0) return null;

  return (
    <ul class="pk-link-list" aria-label={label}>
      {links.map((link) => (
        <li key={link}>
          <a
            class="pk-link-list__link"
            href={link}
            rel="noreferrer noopener"
            target="_blank"
            title={link}
            aria-label={ownerName ? `${ownerName} on ${getLinkLabel(link)} ${NEW_TAB}` : undefined}
          >
            {/* Decoration: the site's name beside it is the accessible name,
                and "in" announced before it would only be noise. */}
            <span class="pk-link-list__mark" aria-hidden="true">
              {getLinkMark(link)}
            </span>
            <span class="pk-link-list__label">{getLinkLabel(link)}</span>
            {/* Dropped from the announcement when `ownerName` supplies the
                whole accessible name, which is why that branch says it too. */}
            <span class="pk-sr-only"> {NEW_TAB}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
