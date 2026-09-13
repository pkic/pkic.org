import socialIcons from "../../shared/social-icons.json";
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
      {links.map((link) => {
        const paths = socialIcons[getLinkMark(link) as keyof typeof socialIcons];
        return (
          <li key={link}>
            <a
              class={`pk-link-list__link${paths ? " pk-link-list__link--icon" : ""}`}
              href={link}
              rel="noreferrer noopener"
              target="_blank"
              title={link}
              aria-label={ownerName ? `${ownerName} on ${getLinkLabel(link)} ${NEW_TAB}` : undefined}
            >
              <svg
                class="pk-link-list__mark"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                {paths ? (
                  paths.map((d) => <path key={d} d={d} />)
                ) : (
                  <path d="M9 2h5v5h-1V3.7L7.4 9.3l-.7-.7L12.3 3H9zM3 3h4v1H3v9h9V9h1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                )}
              </svg>
              <span class={`pk-link-list__label${paths ? " pk-sr-only" : ""}`}>{getLinkLabel(link)}</span>
              {/* Dropped from the announcement when `ownerName` supplies the
                whole accessible name, which is why that branch says it too. */}
              <span class="pk-sr-only"> {NEW_TAB}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
