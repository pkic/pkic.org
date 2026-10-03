import type { SiteListingItem } from "../../shared/site-content";

import { workingGroupIconMarkup } from "./WorkingGroupIcon";

function WorkingGroupIcon({ name }: { name?: string }) {
  const svg = workingGroupIconMarkup(name);
  if (!svg) return null;
  return <span class="pkic-wg-spotlight-icon" dangerouslySetInnerHTML={{ __html: svg }} />;
}

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
  const icon = item.theme ?? slug;
  return (
    <article class={`pkic-wg-spotlight pkic-wg-spotlight--${slug}`}>
      <a class="pkic-wg-spotlight-header-link" href={item.href} tabIndex={-1} aria-hidden="true">
        <div class="pkic-wg-spotlight-header">
          <span class="pkic-wg-spotlight-abbr">{item.tag ?? ""}</span>
          <WorkingGroupIcon name={icon} />
        </div>
      </a>
      <div class="pkic-wg-spotlight-body">
        <h3>
          <a class="pkic-wg-spotlight-title-link" href={item.href}>
            {item.title.replace(/ Working Group$/i, "")}
          </a>
        </h3>
        {item.summary ? <p>{item.summary}</p> : null}
      </div>
      {item.links?.length ? (
        <div class="pkic-wg-spotlight-links">
          {item.links.map((link) => {
            // Hugo opened an absolute URL in a new tab; a site-relative one
            // stays in place.
            const external = /^[a-z]+:\/\//i.test(link.href);
            return (
              <a
                class={`pkic-wg-chip pkic-wg-chip-${link.tone ?? "muted"}`}
                href={link.href}
                key={link.href}
                rel={external ? "external" : undefined}
                target={external ? "_blank" : undefined}
              >
                {link.label}
              </a>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
