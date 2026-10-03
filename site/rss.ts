import rss from "@astrojs/rss";
import type { SiteRssFeed } from "../functions/_lib/services/site-feed";

/** All prerendered feeds use the framework's escaping and RSS serialization. */
export function publishedRssResponse(feed: SiteRssFeed) {
  return rss({
    title: feed.title,
    description: feed.description,
    site: "https://pkic.org",
    customData: `<language>${feed.language}</language>`,
    items: feed.items.map((article) => {
      const published = article.date ? new Date(article.date) : undefined;
      return {
        title: article.title,
        link: article.route,
        pubDate: published && !Number.isNaN(published.valueOf()) ? published : undefined,
        description: article.description,
      };
    }),
  });
}
