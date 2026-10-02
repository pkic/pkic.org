import type { APIContext } from "astro";
import { siteTaxonomyFeeds } from "../../functions/_lib/services/site-content";
import type { SiteRssFeed } from "../../functions/_lib/services/site-feed";
import { publishedRssResponse } from "../rss";

export function getStaticPaths() {
  return siteTaxonomyFeeds().map((feed) => ({
    params: { feed: feed.route.replace(/^\//, "").replace(/\.xml$/, "") },
    props: { feed },
  }));
}

export function GET({ props }: APIContext<{ feed: SiteRssFeed }>) {
  return publishedRssResponse(props.feed);
}
