/**
 * GET /api/v1/votes/feed.rss — RSS 2.0 feed of public votes (PRD §4.8:
 * "Public vote results available as structured JSON API and RSS feed; no
 * scraping required"). One entry per visibility='public' vote, linking to
 * its permanent public URL (`/votes/:slug`, the Hugo static shell §4.8
 * describes).
 */
import { OpenAPIRoute } from "chanfana";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { listPublicVotesForFeed } from "../../../_lib/services/votes";
import { publicVotesFeedRouteSchema } from "../../../../assets/shared/schemas/votes";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function onRequestGet(c: any): Promise<Response> {
  const baseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const votes = await listPublicVotesForFeed(c.env.DB);

  const items = votes
    .map((v) => {
      const link = `${baseUrl}/votes/${v.slug}`;
      const description =
        v.status === "closed" ? `${v.description ?? ""} Closed ${v.closesAt}.`.trim() : (v.description ?? "");
      return `  <item>
    <title>${xmlEscape(v.title)}</title>
    <link>${xmlEscape(link)}</link>
    <guid isPermaLink="true">${xmlEscape(link)}</guid>
    <description>${xmlEscape(description)}</description>
    <pubDate>${new Date(v.closesAt).toUTCString()}</pubDate>
  </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>PKIC Votes</title>
  <link>${xmlEscape(`${baseUrl}/votes/`)}</link>
  <description>Public PKIC forum and working-group vote results</description>
${items}
</channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=900, stale-while-revalidate=60",
    },
  });
}

export class VotesFeedRssGet extends OpenAPIRoute {
  schema = publicVotesFeedRouteSchema;
  async handle(c: any): Promise<Response> {
    return onRequestGet(c);
  }
}
