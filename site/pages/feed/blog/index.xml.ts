import { siteFeedItems } from "../../../../functions/_lib/services/site-content";
import { publishedRssResponse } from "../../../rss";

export function GET() {
  return publishedRssResponse({
    title: "PKI Consortium blog",
    description: "News and articles from the PKI Consortium",
    language: "en",
    route: "/feed/blog/index.xml",
    items: siteFeedItems(),
  });
}
