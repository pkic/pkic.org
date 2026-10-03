import { SiteImage } from "./SiteImage";
import { Fragment } from "preact";

import type { SiteAuthor, SiteListingItem } from "../../shared/site-content";
import { Avatar } from "../ui/Avatar";
import { LocalTime } from "./SiteDate";
import { CalendarGlyph } from "./SiteGlyphs";

import "./BlogCard.css";

/**
 * The author strip under a card, as `blog/author-avatars.html` draws it.
 *
 * Each author's headshot where the byline records one, their initials where it
 * does not, and their name. Three at most are shown, and the rest are counted.
 */
export function AuthorStrip({ authors }: { authors: readonly SiteAuthor[] }) {
  const visible = authors.slice(0, 3);
  const additional = Math.max(0, authors.length - visible.length);
  return (
    <div class="blog-author-avatars-strip">
      <div class="blog-author-avatars-bubbles">
        {/* Decorative: every author shown here is named beside the portraits. */}
        {visible.map((author) => (
          <Avatar key={author.name} name={author.name} src={author.headshot} />
        ))}
        {additional > 0 ? (
          <div class="blog-card-avatar-more" title={`${additional} more authors`}>
            +{additional}
          </div>
        ) : null}
      </div>
      <span class="blog-author-avatars-names">
        {visible.map((author, index) => (
          <Fragment key={author.name}>
            {index > 0 ? ", " : ""}
            {author.archiveHref ? <a href={author.archiveHref}>{author.name}</a> : author.name}
          </Fragment>
        ))}
        {additional > 0 ? <span> +{additional} more</span> : null}
      </span>
    </div>
  );
}

/**
 * A blog card, in the published site's own markup.
 *
 * The header is the card's image: it is cropped to the header's box rather
 * than laid inside it, so a portrait hero and a landscape one both fill the
 * same shape. A post with no image gets the gradient header instead.
 */
export function BlogCard({ item }: { item: SiteListingItem }) {
  const hasPhoto = Boolean(item.imageSrc);
  return (
    <article class="blog-card">
      <div class={`blog-card-header ${hasPhoto ? "blog-card-header--photo" : "blog-card-header--gradient"}`}>
        {item.imageSrc ? (
          <SiteImage src={item.imageSrc} alt={item.title} loading="lazy" width="600" height="260" />
        ) : null}
        <div class="blog-card-header-overlay" />
        {item.tag ? <span class="blog-card-tag">{item.tag}</span> : null}
        <div class="blog-card-header-content">
          <h2 class="blog-card-title">
            <a href={item.href} class="pk-stretched">
              {item.title}
            </a>
          </h2>
          {item.date ? (
            <p class="blog-card-date">
              <CalendarGlyph />
              <LocalTime value={item.date} />
            </p>
          ) : null}
        </div>
      </div>
      <div class="blog-card-body">
        {item.summary ? <p class="blog-card-summary">{item.summary}</p> : null}
        {item.authors?.length ? (
          <div class="blog-card-author">
            <AuthorStrip authors={item.authors} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
