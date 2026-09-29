import { html } from "hono/html";
import { formatDate } from "../../../../assets/shared/format-date";
import type { MemberNewsArticle, MemberNewsPage, MemberNewsQuery } from "../../../../assets/shared/schemas/member-news";

function articleCard(article: MemberNewsArticle) {
  const date = formatDate(article.publishedAt);
  const domain = new URL(article.url).hostname;
  return html`<article class="blog-card news-card${article.sponsorTier ? " news-card--sponsor" : ""}">
    <div class="blog-card-header blog-card-header--gradient">
      <div class="blog-card-header-overlay"></div>
      ${article.sponsorTier ? html`<span class="blog-card-tag news-card-sponsor-badge">★ ${article.sponsorTier}</span>` : ""}
      <div class="blog-card-header-content">
        <h2 class="blog-card-title">
          <a href="${article.url}" target="_blank" rel="noopener noreferrer" class="pk-stretched">${article.title}</a>
        </h2>
        <p class="blog-card-date">
          <time datetime="${article.publishedAt}" data-local-time="${article.publishedAt}" data-local-time-date-only
            >${date}</time
          >
        </p>
      </div>
    </div>
    <div class="blog-card-body">
      <p class="blog-card-summary">
        ${article.summary.length > 160 ? `${article.summary.slice(0, 157)}…` : article.summary}
      </p>
      <div class="news-card-footer">
        <span class="news-card-member-name">${article.organizationName}</span>
        <a href="${new URL(article.url).origin}" target="_blank" rel="noopener noreferrer" class="news-card-domain"
          >${domain}</a
        >
      </div>
    </div>
  </article>`;
}

export async function renderMemberNews(
  page: MemberNewsPage,
  sponsors: MemberNewsArticle[],
  query: MemberNewsQuery,
): Promise<string> {
  const href = (offset: number) =>
    `/news/?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.sort ? { sort: query.sort } : {}), limit: String(query.limit), offset: String(offset) })}`;
  return String(
    await html`<div class="pk-stack pk-stack--loose">
      ${
        sponsors.length && !query.q && query.offset === 0
          ? html`<section class="news-spotlight">
              <h2 class="news-section-heading">Sponsor Highlights</h2>
              <div class="pk-grid pk-grid--roomy">${sponsors.map(articleCard)}</div>
            </section>`
          : ""
      }
      <section class="news-main">
        <h2 class="news-section-heading news-section-heading--plain">Latest Member News</h2>
        <div class="pk-grid pk-grid--roomy">${page.articles.map(articleCard)}</div>
        ${page.articles.length ? "" : html`<p class="pk-center pk-muted pk-section">No news items available at this time.</p>`}
      </section>
      ${
        query.offset > 0 || page.page.hasMore
          ? html`<nav class="pk-cluster" aria-label="News pages">
              ${query.offset > 0 ? html`<a class="pk-btn pk-btn--secondary" href="${href(Math.max(0, query.offset - query.limit))}">Newer articles</a>` : ""}
              ${page.page.hasMore ? html`<a class="pk-btn pk-btn--secondary" href="${href(query.offset + query.limit)}">Older articles</a>` : ""}
            </nav>`
          : ""
      }
    </div>`,
  );
}

/** Hono's HTML escaping also escapes XML text and quoted attributes. */
export async function renderMemberNewsFeed(articles: MemberNewsArticle[], origin: string): Promise<string> {
  return String(
    await html`<?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
      <title>News by the members of the PKI Consortium</title><link>${origin}/news/</link>
      <description>Recent news from the members of the PKI Consortium</description><language>en-US</language>
      <atom:link href="${origin}/news/feed/" rel="self" type="application/rss+xml"/>
      ${articles.map(
        (article) => html`<item><title>${article.title}</title><link>${article.url}</link>
        <guid isPermaLink="true">${article.url}</guid><pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>
        <description>${article.summary}</description><source url="${origin}/news/">${article.organizationName}</source></item>`,
      )}
    </channel></rss>`,
  );
}
