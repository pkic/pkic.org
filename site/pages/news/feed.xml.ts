import { renderMemberNewsFeed } from "../../../functions/_lib/services/member-news/render";
import { publication } from "../../publication";

export async function GET() {
  return new Response(await renderMemberNewsFeed(publication.news.slice(0, 25), "https://pkic.org", "/news/feed.xml"), {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
