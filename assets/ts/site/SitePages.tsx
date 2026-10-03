import { siteStatistics } from "../../shared/site-statistics";
import type { ComponentChildren } from "preact";
import type {
  SiteHero,
  SiteHomeContent,
  SiteListing,
  SitePageMeta,
  SiteSectionNavigation,
} from "../../shared/site-content";
import { ButtonLink } from "../ui/Button";
import { Prose, SiteHero as PageHero, SiteListingSection } from "./SitePrimitives";
import { EventTime, LocalTime } from "./SiteDate";

export interface ContentPageProps {
  children?: ComponentChildren;
  /** `fullwidth` front matter: the wide container rather than the reading one. */
  fullwidth?: boolean;
  hero: SiteHero;
  html: string;
  island?: string;
  listing?: SiteListing;
  meta?: SitePageMeta;
  sectionNavigation?: SiteSectionNavigation;
}

/** Hugo truncated the hero summary on a word boundary, so this does too. */
function truncateWords(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s.,;:]+$/, "")} …`;
}

/**
 * The card beside the home hero: the latest post, then what is coming up.
 *
 * The whole feature is the link target, so its heading and summary sit outside
 * the anchor rather than inside it — that is what lets the summary read as
 * part of the same click without nesting interactive elements.
 */
function HeroFeature({ home }: { home: SiteHomeContent }) {
  const post = home.featuredPost;
  if (!post) return null;
  const event = home.upcomingEvent;
  const moreEvents = Math.max(0, (home.upcomingEventCount ?? 0) - 1);
  return (
    <div class="pkic-home-hero__aside">
      <div class="pkic-hero-post-card pk-stack">
        <div class="pkic-hero-post-feature pk-stack pk-stack--tight">
          <p class="pkic-hero-post-label">Latest News</p>
          <h3 class="pkic-hero-post-title">
            <a class="pk-stretched" href={post.href}>
              {post.title}
            </a>
          </h3>
          {post.date ? <LocalTime class="pkic-hero-post-date" value={post.date} /> : null}
          {post.summary ? <p class="pkic-hero-post-summary">{truncateWords(post.summary, 140)}</p> : null}
          <span class="pkic-hero-post-cta" aria-hidden="true">
            Read more →
          </span>
        </div>
        {event ? (
          <div class="pkic-hero-post-events pk-stack pk-stack--snug">
            <p class="pkic-hero-post-label">Upcoming Events</p>
            {/*
              A div list rather than a `ul`: inside `.pk` the base layer owns
              list padding, and a legacy rule cannot outrank a later layer
              without an `!important`. The roles keep the semantics.
            */}
            <div role="list" class="pk-stack pk-stack--snug">
              <div role="listitem" class="pk-stack pk-stack--tight">
                <a class="pkic-hero-post-title" href={event.href}>
                  {event.title}
                </a>
                {event.date ? (
                  <EventTime class="pkic-hero-post-date" duration={event.duration} value={event.date} />
                ) : null}
              </div>
            </div>
            <a href="/events/" class="pkic-hero-post-cta">
              {moreEvents > 0 ? `+${moreEvents} more · ` : ""}View all upcoming and past events →
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One figure in the band under the hero. */
function Stat({ href, label, value, wideOnly }: { href: string; label: string; value: string; wideOnly?: boolean }) {
  return (
    <a href={href} class={`pkic-stat${wideOnly ? " pkic-stat--wide-only" : ""}`}>
      <span class="pkic-stat-num">{value}</span>
      <span class="pkic-stat-label">{label}</span>
    </a>
  );
}

export function HomePage({ hero, home, html }: { hero: SiteHero; home: SiteHomeContent; html: string }) {
  return (
    <>
      <section class="pk pk-on-solid pkic-home-hero">
        <div class="pk-container pk-container--wide">
          <div class="pkic-home-hero__layout">
            <div class="pk-stack pkic-home-hero__intro">
              {hero.eyebrow ? <p class="pkic-home-hero__kicker">{hero.eyebrow}</p> : null}
              <h1 class="hero-title">{hero.title}</h1>
              {hero.description ? <p class="pkic-home-hero__lead">{hero.description}</p> : null}
              {home.heroLinks?.length ? (
                <div class="pk-cluster">
                  {home.heroLinks.map((link) => (
                    <ButtonLink
                      href={link.href}
                      key={link.href}
                      size="lg"
                      variant={link.primary ? "primary" : "secondary"}
                    >
                      {link.label}
                    </ButtonLink>
                  ))}
                </div>
              ) : null}
            </div>
            <HeroFeature home={home} />
          </div>
        </div>
      </section>
      <div class="pk pkic-stats-bar">
        <div class="pk-container pk-container--wide">
          <div class="pkic-stats-bar__row">
            {siteStatistics(home.workingGroups.length, home.memberCount).map((fact) => (
              <Stat key={fact.label} href={fact.href} label={fact.label} value={fact.value} />
            ))}
            <Stat href="/join/" label="to Join" value="Free" wideOnly />
          </div>
        </div>
      </div>
      {html.trim() ? <div class="pkic-home-content" dangerouslySetInnerHTML={{ __html: html }} /> : null}
    </>
  );
}

function ArticleMeta({ meta }: { meta?: SitePageMeta }) {
  if (!meta?.authors?.length && !meta?.tags?.length) return null;
  return (
    <div class="pk-public-article-meta pk-cluster pk-cluster--center">
      {meta.authors?.length ? <span>By {meta.authors.join(", ")}</span> : null}
      {meta.tags?.length ? <span>{meta.tags.join(" · ")}</span> : null}
    </div>
  );
}

function SectionNavigation({ navigation }: { navigation?: SiteSectionNavigation }) {
  if (!navigation?.items.length) return null;
  return (
    <nav class="pk pk-section-navigation" aria-label="Event pages">
      <div class="pk-container pk-section-navigation__items">
        {navigation.items.map((item) => {
          const matchingItems = navigation.items.filter((candidate) =>
            navigation.currentPath.startsWith(candidate.href),
          );
          const active =
            navigation.currentPath.startsWith(item.href) &&
            !matchingItems.some((candidate) => candidate.href.length > item.href.length);
          return (
            <a class={active ? "is-active" : undefined} href={item.href} aria-current={active ? "page" : undefined}>
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * A page's body, in the shell the published site gives it.
 *
 * `_default/single.html` and `_default/section.html` both write a measured
 * container around a single `#content`, and neither carries `pk`: the body is
 * authored Markdown that the site's own stylesheet dresses, and opting into
 * the design system's base layer would take its 14px application scale, its
 * heading rhythm and its link colours away from it. That is why the reading
 * scale needed an override before this, and why it no longer does.
 */
export function ContentPage({
  children,
  fullwidth,
  hero,
  html,
  island,
  listing,
  meta,
  sectionNavigation,
}: ContentPageProps) {
  const body = html.trim() || listing || island;
  return (
    <>
      <PageHero hero={hero}>
        <ArticleMeta meta={meta} />
      </PageHero>
      <SectionNavigation navigation={sectionNavigation} />
      {body ? (
        <div class={`pk-container${fullwidth ? " pk-container--wide" : ""} pk-section`}>
          <Prose html={html} />
          {/*
            The child listing sits beside `#content` rather than inside it: the
            content stylesheet reaches the body's paragraphs as direct children
            of `#content`, so the Markdown has to be the element's own HTML.
          */}
          {listing ? <SiteListingSection listing={listing} /> : null}
          {island ? <div dangerouslySetInnerHTML={{ __html: island }} /> : null}
          {children}
        </div>
      ) : null}
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageHero hero={{ title: "Page not found", tone: "default" }} />
      <section class="pk pk-public-page">
        <div class="pk-container pk-container--narrow pk-stack pk-stack--loose pk-center">
          <p>The requested page does not exist or is no longer available.</p>
          <p>
            <ButtonLink variant="primary" href="/">
              Return to the home page
            </ButtonLink>
          </p>
        </div>
      </section>
    </>
  );
}
