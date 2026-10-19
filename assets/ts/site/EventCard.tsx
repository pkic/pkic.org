import type { ComponentChildren } from "preact";
import type { EventPhase } from "../../shared/event-phase";
import type { HeadingTag } from "../ui/HeadingOutline";
import "./EventCard.css";
import "./ListingCards.css";
import { SiteImage } from "./SiteImage";
import { IconMapPin } from "../ui/MediaIcons";
import type { SiteListingItem } from "../../shared/site-content";

import "./BlogCard.css";

/**
 * An event, as `partials/events/card.html` renders it.
 *
 * It is a blog card with two additions: a badge that says whether the event
 * has happened, and the venue line under the title in place of the date. The
 * header image is cropped to the header's box rather than laid inside it, so
 * a portrait hero and a landscape one both fill the same shape.
 */
export function EventCard({
  item,
  upcoming,
  phase,
  heading: Heading = "h2",
  children,
}: {
  item: SiteListingItem;
  upcoming?: boolean;
  phase?: EventPhase | null;
  heading?: HeadingTag;
  children?: ComponentChildren;
}) {
  const state = phase === undefined ? (upcoming ? "upcoming" : "past") : phase;
  return (
    <article class="event-card blog-card">
      <div
        class={`event-card-header blog-card-header ${item.imageSrc ? "blog-card-header--photo" : "blog-card-header--gradient"}`}
      >
        {item.imageSrc ? (
          <SiteImage src={item.imageSrc} alt={item.title} loading="lazy" width="600" height="320" />
        ) : null}
        <div class="blog-card-header-overlay" />
        {state && (
          <span class={`blog-card-tag event-card-badge event-card-badge--${state}`}>
            {state === "now" ? "Happening now" : state === "upcoming" ? "Upcoming" : "Past event"}
          </span>
        )}
        <div class="blog-card-header-content">
          <Heading class="blog-card-title">
            <a href={item.href} class="pk-stretched">
              {item.title}
            </a>
          </Heading>
          {item.location ? (
            <p class="blog-card-date event-card-location">
              <IconMapPin width="12" height="12" />
              {item.location}
            </p>
          ) : null}
        </div>
      </div>
      {(item.summary || children) && (
        <div class="blog-card-body">
          {item.summary ? <p class="blog-card-summary">{item.summary}</p> : null}
          {children}
        </div>
      )}
    </article>
  );
}
