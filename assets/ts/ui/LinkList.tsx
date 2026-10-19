import { getLinkLabel } from "../../shared/schemas/links";
import { hasNetworkMark, LinkMark } from "./LinkMark";
import { NEW_TAB_HINT } from "./new-tab";
import "./LinkList.css";
import { ExternalLink } from "../ui/ExternalLink";

export interface LinkListProps {
  links: readonly string[];
  compact?: boolean;
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

export function LinkList({ links, ownerName, label, compact = false }: LinkListProps) {
  if (links.length === 0) return null;

  return (
    <ul class="pk-link-list" aria-label={label}>
      {links.map((link) => {
        const paths = hasNetworkMark(link);
        return (
          <li key={link}>
            <ExternalLink
              class={`pk-link-list__link${paths || compact ? " pk-link-list__link--icon" : ""}`}
              href={link}
              external
              title={link}
              aria-label={ownerName ? `${ownerName} on ${getLinkLabel(link)} ${NEW_TAB_HINT}` : undefined}
            >
              <LinkMark url={link} class="pk-link-list__mark" />
              <span class={`pk-link-list__label${paths || compact ? " pk-sr-only" : ""}`}>{getLinkLabel(link)}</span>
              {/* Dropped from the announcement when `ownerName` supplies the
                whole accessible name, which is why that branch says it too. */}
              <span class="pk-sr-only"> {NEW_TAB_HINT}</span>
            </ExternalLink>
          </li>
        );
      })}
    </ul>
  );
}
