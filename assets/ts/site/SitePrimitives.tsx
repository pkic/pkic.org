import { SiteImage } from "./SiteImage";
import type { ComponentChildren } from "preact";
import type { SiteHero, SiteListing, SiteListingItem } from "../../shared/site-content";
import { ButtonLink } from "../ui/Button";
import { SponsorStripView } from "./SponsorDisplays";
import { BlogCard } from "./BlogCard";
import { EventCard } from "./EventCard";
import { WorkingGroupIcon } from "./WorkingGroupIcon.tsx";
import { WorkingGroupCard } from "./WorkingGroupCard";

import "./SitePages.css";

/**
 * The fluid hero title class.
 *
 * The published site sized the headline by how long it is, so a short title
 * fills the band and a long one still fits on the same number of lines. The
 * thresholds are the ones `hero.html` used.
 */
function heroTitleClass(title: string): string {
  if (title.length > 100) return "hero-title hero-title-xl";
  if (title.length > 65) return "hero-title hero-title-long";
  if (title.length > 38) return "hero-title hero-title-medium";
  return "hero-title";
}

/**
 * A page hero.
 *
 * The published markup, so the ported hero stylesheet owns it: the theme
 * modifier repoints the ground, `pk-on-solid` makes the call to action read
 * against that ground rather than against the page, and the lead's links stay
 * white with the wavy underline instead of taking the page's accent ink.
 */
export function SiteHero({ children, hero }: { children?: ComponentChildren; hero: SiteHero }) {
  if (hero.imageSrc) {
    return (
      <div
        class={`pk pk-on-solid pkic-hero-media${hero.imageSize && hero.imageSize !== "default" ? ` pkic-hero-media--${hero.imageSize}` : ""}${hero.sponsor ? " pkic-hero-media--sponsored" : ""}`}
      >
        <SiteImage class="pkic-hero-media__image" src={hero.imageSrc} alt={hero.imageAlt ?? ""} />
        <div class="pk pkic-hero-media__scrim">
          <div class="pk-container pk-container--wide pk-stack pk-center pkic-hero-media__content">
            {hero.eyebrow ? <p class="pkic-page-hero-kicker">{hero.eyebrow}</p> : null}
            <h1 class={heroTitleClass(hero.title)}>{hero.title}</h1>
            {hero.descriptionHtml ? (
              <p class="pkic-hero-lead" dangerouslySetInnerHTML={{ __html: hero.descriptionHtml }} />
            ) : hero.description ? (
              <p class="pkic-hero-lead">{hero.description}</p>
            ) : null}
            {hero.button ? (
              <div class="pk-cluster pk-cluster--center">
                <ButtonLink href={hero.button.href} size="lg" variant="primary">
                  {hero.button.label}
                </ButtonLink>
              </div>
            ) : null}
            {children}
          </div>
        </div>
        {hero.sponsor ? <HeroSponsors sponsor={hero.sponsor} /> : null}
      </div>
    );
  }

  return (
    <div class={`pk pk-on-solid pkic-page-hero pkic-page-hero--${hero.tone}${hero.wgId ? ` wg-${hero.wgId}` : ""}`}>
      {hero.wgId ? <WorkingGroupIcon className="pkic-page-hero-watermark" name={hero.icon ?? hero.wgId} /> : null}
      <div class="pk-container pk-stack pk-center pkic-page-hero__body">
        {hero.eyebrow ? <p class="pkic-page-hero-kicker">{hero.eyebrow}</p> : null}
        <h1 class={heroTitleClass(hero.title)}>{hero.title}</h1>
        {hero.descriptionHtml ? (
          <p class="pkic-hero-lead" dangerouslySetInnerHTML={{ __html: hero.descriptionHtml }} />
        ) : hero.description ? (
          <p class="pkic-hero-lead">{hero.description}</p>
        ) : null}
        {hero.button ? (
          <div class="pk-cluster pk-cluster--center">
            <ButtonLink href={hero.button.href} size="lg" variant="primary">
              {hero.button.label}
            </ButtonLink>
          </div>
        ) : null}
        {children}
      </div>
      {hero.sponsor ? <HeroSponsors sponsor={hero.sponsor} /> : null}
    </div>
  );
}

function HeroSponsors({ sponsor }: { sponsor: NonNullable<SiteHero["sponsor"]> }) {
  if (sponsor.publishedSponsors)
    return (
      <div class="pkic-hero-sponsor-band">
        <SponsorStripView
          sponsors={sponsor.publishedSponsors}
          eventName={sponsor.eventName}
          containerClass="hero-sponsors-container"
          linkClass="hero-sponsor-link"
          logoClass="hero-sponsor-logo"
          label="Our Diamond & Titanium Sponsors"
        />
      </div>
    );
  return (
    <div class="hero-sponsor-host">
      <div
        data-module="member-flows/sponsors-wall"
        data-sponsors-wall
        data-api-base="/api/v1"
        data-mode="strip"
        data-event-slug={sponsor.eventSlug}
        data-event-name={sponsor.eventName}
        data-min-weight={sponsor.minimumWeight}
        data-label="Our Diamond & Titanium Sponsors"
      />
    </div>
  );
}

/** Hugo's `truncate`: cut on a word boundary and close with an ellipsis. */
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

/**
 * A child page of a section, as `partials/subpage-card.html` renders it.
 *
 * The whole card is the link, so it is an `a` rather than a box with a
 * handler, and its three lines take their rhythm from `.wg-explore-card`.
 */
function SubPageCard({ item }: { item: SiteListingItem }) {
  return (
    <a class="wg-explore-card" href={item.href}>
      <div class="wg-explore-title">{item.title}</div>
      {item.summary ? <div class="wg-explore-desc">{truncate(item.summary, 160)}</div> : null}
      <div class="wg-explore-arrow pk-push-block">Read more →</div>
    </a>
  );
}

function pageHref(listing: SiteListing, page: number): string {
  return page === 1 ? (listing.basePath ?? "/") : `${listing.basePath}page/${page}/`;
}

/**
 * A list of pages, in the shape the published site gives that list.
 *
 * Hugo had no single list component: the blog wrote a roomy card grid with a
 * pager beneath it, a section wrote its children as explore cards, and the
 * working-group index wrote its own spotlight. What they share is the grid
 * utility, so that is what is shared here — the card is chosen by kind, and
 * no wrapper of our own sits around it.
 */
/** The band a named home-page section sits in, and the grid inside it. */
const BANDS: Record<string, { grid: string; section: string; solidHeader?: boolean }> = {
  blog: { grid: "pk-grid pk-grid--roomy", section: "pkic-recent-posts pk-section" },
  events: { grid: "pk-grid pk-grid--roomy", section: "pk-section", solidHeader: true },
  "working-groups": { grid: "pkic-wg-grid", section: "pkic-wg-section pk-section" },
};

/**
 * A list of pages, in the shape the published site gives that list.
 *
 * Hugo had no single list component. A home-page band names itself and links
 * on to the full list; a list page writes its cards straight into the column
 * with the pager beneath; a section's children sit under its prose with no
 * heading over them at all. What they share is the grid utility, so that is
 * what is shared here — the card is chosen by kind, the wrapper by layout.
 */
export function SiteListingSection({
  listing,
  moreHref,
  moreLabel,
}: {
  listing: SiteListing;
  moreHref?: string;
  moreLabel?: string;
}) {
  const kind = listing.kind ?? "cards";
  const gridClass = `pk-grid ${kind === "working-groups" ? "pkic-working-group-list" : "pk-grid--roomy"}`;
  const today = new Date().toISOString().slice(0, 10);
  const cards = listing.items.map((item) =>
    kind === "blog" ? (
      <BlogCard item={item} key={item.href} />
    ) : kind === "events" ? (
      <EventCard item={item} key={item.href} upcoming={(item.date ?? "") >= today} />
    ) : kind === "working-groups" ? (
      <WorkingGroupCard item={item} key={item.href} />
    ) : (
      <SubPageCard item={item} key={item.href} />
    ),
  );

  if (listing.layout === "band") {
    const band = BANDS[kind] ?? BANDS.blog!;
    return (
      <section class={band.section}>
        <div class="pk-container pk-stack pk-stack--loose">
          <div class={`${band.solidHeader ? "pk " : ""}pk-cluster pk-cluster--between`}>
            <h2>{listing.heading}</h2>
            {moreHref ? (
              <ButtonLink href={moreHref} size="sm" variant="secondary">
                {moreLabel ?? "View all →"}
              </ButtonLink>
            ) : null}
          </div>
          <div class={band.grid}>{cards}</div>
        </div>
      </section>
    );
  }

  if (listing.layout === "page") {
    // ContentPage already supplies the measured container and its side gutters.
    return (
      <div class="pk-section">
        <div class="pk-stack pk-stack--loose">
          <div class={gridClass}>{cards}</div>
          {listing.pageCount > 1 ? <ListingPager listing={listing} /> : null}
        </div>
      </div>
    );
  }

  return (
    <section class="pk-stack pk-stack--loose" aria-label={listing.heading}>
      <div class={gridClass}>{cards}</div>
      {listing.note ? <p class="pk-small">{listing.note}</p> : null}
      {listing.pageCount > 1 ? <ListingPager listing={listing} /> : null}
    </section>
  );
}

/**
 * The pager, written as `partials/pagination.html` writes it.
 *
 * One stylesheet dresses the portal's pager and the public list pages alike,
 * so this is the same DOM `ui/Pager.tsx` produces: a window of pages either
 * side of the current one, with the first and last always reachable, and a
 * `span` rather than a dead link where there is nowhere to go.
 */
export function ListingPager({ listing }: { listing: SiteListing }) {
  const window = 2;
  /*
   * The window, the first page and the last page get a number; the two pages
   * that sit just inside the ends stand in for everything they hide, as an
   * ellipsis. That is `partials/pagination.html`'s own rule, so the pager on
   * one list page is the pager on the next.
   */
  const pages = Array.from({ length: listing.pageCount }, (_value, index) => index + 1).flatMap((page) => {
    const near = page >= listing.page - window && page <= listing.page + window;
    if (page === 1 || page === listing.pageCount || near) return [{ gap: false, page }];
    if (page === 2 || page === listing.pageCount - 1) return [{ gap: true, page }];
    return [];
  });
  return (
    <nav class="pk-pager pk-pager--center" aria-label="Page navigation">
      <ol class="pk-pager__list">
        <li class="pk-pager__item">
          {listing.page > 1 ? (
            <a
              class="pk-pager__button pk-pager__button--prev"
              href={pageHref(listing, listing.page - 1)}
              rel="prev"
              aria-label="Previous page"
            >
              ‹
            </a>
          ) : (
            <span class="pk-pager__button pk-pager__button--prev" aria-disabled="true" aria-label="Previous page">
              ‹
            </span>
          )}
        </li>
        {pages.map((entry) =>
          entry.gap ? (
            <li class="pk-pager__item pk-pager__item--gap" aria-hidden="true" key={`gap-${entry.page}`}>
              …
            </li>
          ) : (
            <li class="pk-pager__item" key={entry.page}>
              <a
                class="pk-pager__button"
                href={pageHref(listing, entry.page)}
                aria-current={entry.page === listing.page ? "page" : undefined}
                aria-label={entry.page === listing.page ? `Page ${entry.page}, current page` : `Page ${entry.page}`}
              >
                {entry.page}
              </a>
            </li>
          ),
        )}
        <li class="pk-pager__item">
          {listing.page < listing.pageCount ? (
            <a
              class="pk-pager__button pk-pager__button--next"
              href={pageHref(listing, listing.page + 1)}
              rel="next"
              aria-label="Next page"
            >
              ›
            </a>
          ) : (
            <span class="pk-pager__button pk-pager__button--next" aria-disabled="true" aria-label="Next page">
              ›
            </span>
          )}
        </li>
      </ol>
    </nav>
  );
}

/**
 * The page body, in the element the published site indexes and styles.
 *
 * `#content` is the hook the content stylesheet keys off — including rules
 * that reach its paragraphs as direct children, which is why the Markdown
 * goes straight into it rather than into a wrapper of its own.
 */
export function Prose({ html }: { html: string }) {
  return <div id="content" data-pagefind-body dangerouslySetInnerHTML={{ __html: html }} />;
}
