import "./ListingCards.css";
import type { SiteListingItem } from "../../shared/site-content";

import { workingGroupIconMarkup } from "./WorkingGroupIcon";
import { ExternalLink } from "../ui/ExternalLink";

/**
 * A working group, as the published spotlight card shows it.
 *
 * `partials/wg/spotlight-card.html` renders this on the home page and on the
 * working-group index, so both read the same card. The header's gradient is
 * authored per group in front matter and reaches CSS as a rule keyed by the
 * group's slug, which is why the card only has to name the slug here.
 */
export function WorkingGroupCard({ item }: { item: SiteListingItem }) {
  // The card is keyed by the group's own id — `wgID | lower` — while its
  // watermark is the icon the group names, which is not always the same
  // (TCWG draws the `tc` mark, and CA names none at all).
  const slug = item.tag?.toLowerCase() ?? "default";
  const icon = workingGroupIconMarkup(item.theme ?? slug);
  return (
    <article class={`pkic-wg-spotlight pkic-wg-spotlight--${slug}`}>
      {item.tag || icon ? (
        <a class="pkic-wg-spotlight-header-link" href={item.href} tabIndex={-1} aria-hidden="true">
          <div class="pkic-wg-spotlight-header">
            {item.tag ? <span class="pkic-wg-spotlight-abbr">{item.tag}</span> : null}
            {icon ? <span class="pkic-wg-spotlight-icon" dangerouslySetInnerHTML={{ __html: icon }} /> : null}
          </div>
        </a>
      ) : null}
      <div class="pkic-wg-spotlight-body">
        <div class="pkic-wg-spotlight-heading">
          <h3 class="pkic-wg-spotlight-title">
            <a class="pkic-wg-spotlight-title-link" href={item.href}>
              {item.title.replace(/ Working Group$/i, "")}
            </a>
          </h3>
        </div>
        {item.summary ? <p>{item.summary}</p> : null}
      </div>
      {item.links?.length ? (
        <div class="pkic-wg-spotlight-links">
          {item.links.map((link) => {
            // Hugo opened an absolute URL in a new tab; a site-relative one
            // stays in place.
            const external = /^[a-z]+:\/\//i.test(link.href);
            return (
              <ExternalLink
                class={`pkic-wg-chip pkic-wg-chip-${link.tone ?? "muted"}`}
                href={link.href}
                key={link.href}
                external={external}
              >
                {link.label}
              </ExternalLink>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
