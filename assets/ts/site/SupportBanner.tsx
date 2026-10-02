import { ButtonLink } from "../ui/Button";

export interface SupportBannerLink {
  primary?: boolean;
  text?: string;
  url?: string;
}

function safeHref(value?: string): string {
  if (!value) return "#";
  return /^javascript:/i.test(value.trim()) ? "#" : value;
}

/**
 * The support call to action between sections, as `partials/banner.html`
 * draws it.
 *
 * It carries no `pk` root: the card's ink and its quiet link are coloured by
 * the site's own stylesheet, which the design system's base layer would beat,
 * and the card is dark. The card itself is `pk-on-solid`, because it paints
 * its own gradient and a filled button would otherwise be dark on dark.
 *
 * `data-reveal` is the scroll-in hook the public entry observes.
 */
export function SupportBanner({
  body,
  heading,
  links,
  stat,
  statLabel,
  variant = "inline",
}: {
  body?: string;
  heading?: string;
  links?: SupportBannerLink[];
  stat?: string;
  statLabel?: string;
  /** `inline` sits between sections in its own card; `banner` runs full width. */
  variant?: string;
}) {
  if (!heading) return null;
  const inner = (
    <div class="support-cta-inner pk-on-solid">
      {stat ? (
        <div class="support-cta-stat-col">
          <span class="support-cta-stat">{stat}</span>
          {statLabel ? <span class="support-cta-stat-label">{statLabel}</span> : null}
        </div>
      ) : null}
      <div class="support-cta-text">
        <p class="support-cta-heading">{heading}</p>
        {body ? <div class="support-cta-body" dangerouslySetInnerHTML={{ __html: body }} /> : null}
        {links?.length ? (
          <div class="support-cta-actions">
            {links.map((link, index) =>
              link.primary ? (
                <ButtonLink href={safeHref(link.url)} key={`${link.url ?? "link"}-${index}`} variant="primary">
                  {link.text ?? link.url ?? "Continue"}
                </ButtonLink>
              ) : (
                <a class="support-cta-link" href={safeHref(link.url)} key={`${link.url ?? "link"}-${index}`}>
                  {link.text ?? link.url ?? "Continue"} →
                </a>
              ),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
  return (
    <div class={`support-cta support-cta--${variant}`} data-reveal>
      {variant === "banner" ? <div class="pk-container">{inner}</div> : <div class="support-cta-card">{inner}</div>}
    </div>
  );
}
