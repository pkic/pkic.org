import type { MemberNewsArticle, MemberNewsPage, MemberNewsQuery } from "../../../../assets/shared/schemas/member-news";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";

/** A changed feed or ended membership hides cached articles immediately. */
const ARTICLE_SOURCE = `FROM member_news_articles article
  JOIN organizations organization ON organization.id = article.organization_id
    AND organization.blog_feed_url = article.feed_url
  JOIN members member ON member.organization_id = organization.id AND member.status = 'active'
  LEFT JOIN sponsorship_tier_catalog tier ON tier.sponsor_type = 'consortium'
    AND tier.tier = organization.sponsor_tier AND tier.active = 1
  WHERE article.published_at <= ?`;
const ARTICLE_COLUMNS = `article.url, article.title, article.summary, article.published_at AS publishedAt,
  organization.name AS organizationName, tier.tier AS sponsorTier`;

export async function readMemberNews(db: DatabaseLike, query: MemberNewsQuery): Promise<MemberNewsPage> {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["article.title", "article.summary", "organization.name"])
    : null;
  const { rows, total } = await queryPage<MemberNewsArticle>(db, {
    source: {
      selectSql: `SELECT ${ARTICLE_COLUMNS}`,
      fromSql: `${ARTICLE_SOURCE}${search ? ` AND ${search.sql}` : ""}`,
      bindings: [nowIso(), ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { publishedAt: "article.published_at", title: "article.title COLLATE NOCASE" },
      "article.published_at DESC",
      "article.organization_id ASC, article.url ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return { articles: rows, page: buildPageInfo(query.limit, query.offset, total, rows.length) };
}

export async function readSponsorNews(db: DatabaseLike): Promise<MemberNewsArticle[]> {
  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const result = await db
    .prepare(
      `WITH ranked AS (
    SELECT ${ARTICLE_COLUMNS}, ROW_NUMBER() OVER (PARTITION BY article.organization_id ORDER BY article.published_at DESC, article.url ASC) AS position
    ${ARTICLE_SOURCE} AND tier.tier IS NOT NULL AND article.published_at >= ?
  ) SELECT url, title, summary, publishedAt, organizationName, sponsorTier FROM ranked
    WHERE position = 1 ORDER BY publishedAt DESC, url ASC LIMIT 12`,
    )
    .bind(nowIso(), cutoff)
    .all<MemberNewsArticle>();
  return result.results;
}
