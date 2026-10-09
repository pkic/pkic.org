import { SiteImage } from "./SiteImage";
import type { SiteEventsIndex, SiteListingItem } from "../../shared/site-content";
import { EventCard } from "./EventCard";
import { LocalTime } from "./SiteDate";
import { ButtonLink } from "../ui/Button";
import { IconCalendar, IconMapPin } from "../ui/MediaIcons";

import "./BlogCard.css";

function WebinarCard({ item, upcoming }: { item: SiteListingItem; upcoming: boolean }) {
  return (
    <div class="event-webinar-card">
      <div class={`event-webinar-card-banner${item.imageSrc ? " event-webinar-card-banner--photo" : ""}`}>
        {item.imageSrc ? (
          <SiteImage
            src={item.imageSrc}
            alt={item.title}
            class="event-webinar-card-banner-img"
            width="400"
            height="144"
            loading="lazy"
          />
        ) : null}
        <div class="event-webinar-card-banner-overlay" />
        <span class="event-webinar-badge">Sponsored Webinar</span>
      </div>
      <div class="event-webinar-card-body">
        <h3 class="event-webinar-title">
          <a href={item.href}>{item.title}</a>
        </h3>
        {item.date ? (
          <p class="event-webinar-meta">
            <IconCalendar width="11" height="11" />
            <LocalTime format="date-time" value={item.date} />
          </p>
        ) : null}
        {item.location ? (
          <p class="event-webinar-meta">
            <IconMapPin width="11" height="11" />
            {item.location}
          </p>
        ) : null}
        {item.summary ? <p class="event-webinar-summary">{item.summary}</p> : null}
        {upcoming && item.button ? (
          <ButtonLink
            class="event-webinar-register-btn"
            href={item.button.href}
            rel="noopener noreferrer"
            size="sm"
            target="_blank"
            variant="primary"
          >
            {item.button.label}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}

function YearGroup({ group, upcoming }: { group: { events: SiteListingItem[]; year: string }; upcoming: boolean }) {
  return (
    <div class="pk-grid pk-grid--roomy">
      {group.events.map((event) => (
        <EventCard item={event} key={event.href} upcoming={upcoming} />
      ))}
    </div>
  );
}

function Sidebar({ events }: { events: SiteEventsIndex }) {
  const { sidebar, webinars } = events;
  const upcoming = webinars.upcoming.slice(0, 3);
  const past = webinars.past.slice(0, 2);
  return (
    <aside>
      <div class="events-sidebar pk-stack">
        <div class="events-sidebar-header">
          <h2 class="events-sidebar-title">{sidebar?.title ?? "Sponsored Webinars"}</h2>
          {sidebar?.description ? (
            <div class="events-sidebar-desc" dangerouslySetInnerHTML={{ __html: sidebar.description }} />
          ) : null}
        </div>
        {upcoming.length ? (
          <div class="events-webinar-list">
            {upcoming.map((item) => (
              <WebinarCard item={item} key={item.href} upcoming />
            ))}
          </div>
        ) : null}
        {past.length ? (
          <>
            {upcoming.length ? <h3 class="events-webinar-past-heading">Past Webinars</h3> : null}
            <div class="events-webinar-list">
              {past.map((item) => (
                <WebinarCard item={item} key={item.href} upcoming={false} />
              ))}
            </div>
          </>
        ) : null}
        {upcoming.length || past.length ? (
          <ButtonLink href="/events/webinars/" size="sm" variant="secondary">
            View all webinars
          </ButtonLink>
        ) : (
          <div class="events-webinar-empty">
            <p>
              Interested in hosting a sponsored webinar? <a href="/sponsors/">Learn about sponsorship</a>.
            </p>
          </div>
        )}
        <div class="events-sidebar-cta pk-stack pk-stack--snug">
          <p class="pk-small">{sidebar?.cta ?? "Want to host a sponsored webinar?"}</p>
          <ButtonLink href={sidebar?.ctaLink ?? "/sponsors/"} size="sm" variant="secondary">
            {sidebar?.ctaLabel ?? "Sponsorship opportunities"}
          </ButtonLink>
        </div>
      </div>
    </aside>
  );
}

/**
 * The events index, as `layouts/events/list.html` lays it out.
 *
 * Two columns: the consortium's own events grouped by year in the main one,
 * and the sponsored webinars beside them. Upcoming events come first and are
 * badged as such; everything else is grouped newest year first.
 */
export function EventsIndex({ events, html }: { events: SiteEventsIndex; html: string }) {
  const hasEvents = events.upcoming.length > 0 || events.past.length > 0;
  return (
    <div class="events-listing pk-section">
      <div class="pk-container pk-container--wide events-listing-layout">
        <div class="pk-stack pk-stack--loose">
          {events.upcoming.length ? (
            <section class="events-section events-section--upcoming pk-stack pk-stack--loose">
              <div class="events-section-header">
                <h2 class="events-section-title">
                  <span class="events-section-title-badge events-section-title-badge--upcoming">Upcoming</span>
                  PKI Consortium Events
                </h2>
              </div>
              {events.upcoming.map((group) => (
                <YearGroup group={group} key={group.year} upcoming />
              ))}
            </section>
          ) : null}

          {html.trim() ? <div dangerouslySetInnerHTML={{ __html: html }} /> : null}

          {events.past.length ? (
            <section class="events-section events-section--past pk-stack pk-stack--loose">
              <div class="events-section-header">
                <h2 class="events-section-title">{events.upcoming.length ? "Past Events" : "PKI Consortium Events"}</h2>
              </div>
              {events.past.map((group) => (
                <div class="events-year-group" key={group.year}>
                  <h3 class="events-year-heading">{group.year}</h3>
                  <YearGroup group={group} upcoming={false} />
                </div>
              ))}
            </section>
          ) : null}

          {hasEvents ? null : <p class="pk-muted">No events found.</p>}
        </div>
        <Sidebar events={events} />
      </div>
    </div>
  );
}
