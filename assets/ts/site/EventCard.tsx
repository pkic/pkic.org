import { SiteImage } from "./SiteImage";
import type { SiteListingItem } from "../../shared/site-content";

import "./BlogCard.css";

function LocationGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/**
 * An event, as `partials/events/card.html` renders it.
 *
 * It is a blog card with two additions: a badge that says whether the event
 * has happened, and the venue line under the title in place of the date. The
 * header image is cropped to the header's box rather than laid inside it, so
 * a portrait hero and a landscape one both fill the same shape.
 */
export function EventCard({ item, upcoming }: { item: SiteListingItem; upcoming: boolean }) {
  return (
    <article class="event-card blog-card">
      <div
        class={`event-card-header blog-card-header ${item.imageSrc ? "blog-card-header--photo" : "blog-card-header--gradient"}`}
      >
        {item.imageSrc ? (
          <SiteImage src={item.imageSrc} alt={item.title} loading="lazy" width="600" height="320" />
        ) : null}
        <div class="blog-card-header-overlay" />
        <span class={`blog-card-tag event-card-badge event-card-badge--${upcoming ? "upcoming" : "past"}`}>
          {upcoming ? "Upcoming" : "Past event"}
        </span>
        <div class="blog-card-header-content">
          <h2 class="blog-card-title">
            <a href={item.href} class="pk-stretched">
              {item.title}
            </a>
          </h2>
          {item.location ? (
            <p class="blog-card-date event-card-location">
              <LocationGlyph />
              {item.location}
            </p>
          ) : null}
        </div>
      </div>
      <div class="blog-card-body">{item.summary ? <p class="blog-card-summary">{item.summary}</p> : null}</div>
    </article>
  );
}
