import type { DatabaseLike } from "../../types";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { nowIso } from "../../utils/time";
import { fetchMemberFeed } from "./feed-parser";

interface FeedSource {
  organization_id: string;
  feed_url: string;
}
const CURRENT_SOURCE = `EXISTS (SELECT 1 FROM organizations organization
  JOIN members member ON member.organization_id = organization.id AND member.status = 'active'
  WHERE organization.id = ? AND organization.blog_feed_url = ?)`;

/** Scheduled refresh owns retries; public requests read only the last successful cache. */
export async function refreshMemberNews(db: DatabaseLike, budget?: D1QueryBudget) {
  const summary = { refreshed: 0, failed: 0 };
  if (!hasD1QueryCapacity(budget, 4)) return { summary };
  const now = nowIso();
  const sources = await db
    .prepare(
      `SELECT organization.id AS organization_id, organization.blog_feed_url AS feed_url
    FROM organizations organization
    JOIN members member ON member.organization_id = organization.id AND member.status = 'active'
    LEFT JOIN member_news_sources source ON source.organization_id = organization.id
    WHERE organization.blog_feed_url IS NOT NULL AND TRIM(organization.blog_feed_url) <> ''
      AND (source.organization_id IS NULL OR source.feed_url <> organization.blog_feed_url OR source.next_refresh_at <= ?)
    ORDER BY COALESCE(source.next_refresh_at, '') ASC, organization.id ASC LIMIT 8`,
    )
    .bind(now)
    .all<FeedSource>();
  for (const source of sources.results) {
    if (!hasD1QueryCapacity(budget, 3)) break;
    let articles;
    let error: string | null = null;
    try {
      articles = await fetchMemberFeed(source.feed_url);
    } catch (caught) {
      error = caught instanceof Error ? caught.message.slice(0, 500) : "Feed retrieval failed";
    }
    const next = new Date(Date.parse(now) + (error ? 3_600_000 : 86_400_000)).toISOString();
    const state = db
      .prepare(
        `INSERT INTO member_news_sources
      (organization_id, feed_url, next_refresh_at, last_success_at, last_error)
      SELECT ?, ?, ?, ?, ? WHERE ${CURRENT_SOURCE}
      ON CONFLICT(organization_id) DO UPDATE SET feed_url = excluded.feed_url,
        next_refresh_at = excluded.next_refresh_at, last_error = excluded.last_error,
        last_success_at = CASE WHEN excluded.last_error IS NULL THEN excluded.last_success_at
          WHEN member_news_sources.feed_url = excluded.feed_url THEN member_news_sources.last_success_at ELSE NULL END`,
      )
      .bind(
        source.organization_id,
        source.feed_url,
        next,
        error ? null : now,
        error,
        source.organization_id,
        source.feed_url,
      );
    if (articles) {
      await db.batch([
        db
          .prepare(`DELETE FROM member_news_articles WHERE organization_id = ? AND ${CURRENT_SOURCE}`)
          .bind(source.organization_id, source.organization_id, source.feed_url),
        db
          .prepare(
            `INSERT INTO member_news_articles (organization_id, feed_url, url, title, summary, published_at)
          SELECT ?, ?, json_extract(value, '$.url'), json_extract(value, '$.title'), json_extract(value, '$.summary'), json_extract(value, '$.publishedAt')
          FROM json_each(?) WHERE ${CURRENT_SOURCE}`,
          )
          .bind(
            source.organization_id,
            source.feed_url,
            JSON.stringify(articles),
            source.organization_id,
            source.feed_url,
          ),
        state,
      ]);
      summary.refreshed += 1;
    } else {
      await state.run();
      summary.failed += 1;
    }
  }
  return { summary };
}
