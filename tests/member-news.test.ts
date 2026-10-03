import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { memberNewsQuerySchema } from "../assets/shared/schemas/member-news";
import {
  parseMemberFeed,
  fetchMemberFeed,
  validateFeedFetchUrl,
} from "../functions/_lib/services/member-news/feed-parser";
import { readMemberNews, readSponsorNews } from "../functions/_lib/services/member-news/read";
import { refreshMemberNews } from "../functions/_lib/services/member-news/refresh";
import { renderMemberNews, renderMemberNewsFeed } from "../functions/_lib/services/member-news/render";
import { insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const feedUrl = "https://news.example.test/feed.xml";
const publishedAt = new Date(Date.now() - 86_400_000).toISOString();
const rss = (title = "Certificates &amp; trust", count = 1) =>
  `<rss version="2.0"><channel><title>Publisher</title><language>en-US</language>${Array.from({ length: count }, (_, i) => `<item><title>${title} ${i}</title><link>https://news.example.test/article-${i}</link><pubDate>${publishedAt}</pubDate><description><![CDATA[<p>A useful article about certificate operations.</p>]]></description></item>`).join("")}</channel></rss>`;

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());
async function source() {
  const organizationId = await insertOrganization(env.DB, "News publisher");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  await env.DB.prepare("UPDATE organizations SET blog_feed_url = ?, sponsor_tier = 'Gold' WHERE id = ?")
    .bind(feedUrl, organizationId)
    .run();
  return { organizationId, memberId };
}
const read = (options = {}) => readMemberNews(env.DB, memberNewsQuerySchema.parse(options));

describe("member news feed boundaries", () => {
  it("normalizes RSS and Atom, bounds articles, and drops future or unsafe links", () => {
    expect(parseMemberFeed(rss(), feedUrl)[0]).toMatchObject({
      title: "Certificates & trust 0",
      summary: "A useful article about certificate operations.",
      publishedAt,
    });
    expect(parseMemberFeed(rss("Article", 30), feedUrl)).toHaveLength(20);
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en"><title>Publisher</title><entry><title>Atom</title><link rel="alternate" href="/atom"/><published>${publishedAt}</published><summary>Useful Atom feed summary.</summary></entry></feed>`;
    expect(parseMemberFeed(atom, feedUrl)[0]?.url).toBe("https://news.example.test/atom");
    expect(parseMemberFeed(rss().replace(publishedAt, "2999-01-01T00:00:00.000Z"), feedUrl)).toEqual([]);
    expect(
      parseMemberFeed(rss().replace("https://news.example.test/article-0", "javascript:alert(1)"), feedUrl),
    ).toEqual([]);
    expect(parseMemberFeed(rss().replace("en-US", "nl-NL"), feedUrl)).toEqual([]);
  });
  it("rejects malformed XML, custom entities, oversized feeds, and private URL forms", () => {
    for (const value of [
      "<rss>",
      "<!DOCTYPE rss [<!ENTITY x 'x'>]><rss/>",
      "x".repeat(1_048_577),
      "<html>wrong content</html>",
    ])
      expect(() => parseMemberFeed(value, feedUrl)).toThrow();
    for (const value of [
      "http://127.0.0.1/feed",
      "http://[::1]/",
      "https://user:pass@example.com/",
      "https://host.local/",
      "https://example.com:8080/",
    ])
      expect(() => validateFeedFetchUrl(value)).toThrow();
  });
  it("checks redirects before fetching their destination and enforces streamed size limits", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchMemberFeed(feedUrl)).rejects.toThrow("public HTTP");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response("x".repeat(1_048_577)));
    await expect(fetchMemberFeed(feedUrl)).rejects.toThrow("size limit");
  });
});

describe("D1 member news cache and public rendering", () => {
  it("serves the same paged D1 articles in SSR and RSS without any feed fetch during reads", async () => {
    await source();
    const fetcher = vi.fn().mockImplementation(async () => new Response(rss("Certificates &amp; trust", 3)));
    vi.stubGlobal("fetch", fetcher);
    expect((await refreshMemberNews(env.DB)).summary).toEqual({ refreshed: 1, failed: 0 });
    const page = await read({ q: "News publisher", limit: 2 });
    expect(page.page).toMatchObject({ total: 3, hasMore: true });
    expect(page.articles).toHaveLength(2);
    expect(await readSponsorNews(env.DB)).toHaveLength(1);
    const html = await renderMemberNews(page, await readSponsorNews(env.DB), memberNewsQuerySchema.parse({ limit: 2 }));
    expect(html).toContain("Certificates &amp; trust");
    expect(html).toContain("Older articles");
    expect(html).toContain('data-local-time-format="date"');
    expect(html).toContain("Sponsor Highlights");
    const parsed = new XMLParser().parse(await renderMemberNewsFeed((await read()).articles, "https://pkic.org"), true);
    expect(parsed.rss.channel.item).toHaveLength(3);
    expect(parsed.rss.channel.item[0].title).toBe(page.articles[0].title);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await refreshMemberNews(env.DB)).summary.refreshed).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains last successful articles after a failure and hides changed feeds and ended members", async () => {
    const f = await source();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(rss())),
    );
    await refreshMemberNews(env.DB);
    await env.DB.prepare("UPDATE member_news_sources SET next_refresh_at = '2000-01-01T00:00:00.000Z'").run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unavailable", { status: 503 })),
    );
    expect((await refreshMemberNews(env.DB)).summary.failed).toBe(1);
    expect((await read()).page.total).toBe(1);
    expect(
      await env.DB.prepare("SELECT last_error FROM member_news_sources WHERE organization_id = ?")
        .bind(f.organizationId)
        .first("last_error"),
    ).toContain("503");
    await env.DB.prepare("UPDATE organizations SET blog_feed_url = 'https://new.example.test/feed' WHERE id = ?")
      .bind(f.organizationId)
      .run();
    expect((await read()).page.total).toBe(0);
    await env.DB.prepare("UPDATE organizations SET blog_feed_url = ? WHERE id = ?")
      .bind(feedUrl, f.organizationId)
      .run();
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(f.memberId).run();
    expect((await read()).page.total).toBe(0);
  });
  it("does not publish an old feed when the organization changes it during retrieval", async () => {
    const f = await source();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await env.DB.prepare("UPDATE organizations SET blog_feed_url = 'https://new.example.test/feed' WHERE id = ?")
          .bind(f.organizationId)
          .run();
        return new Response(rss());
      }),
    );
    await refreshMemberNews(env.DB);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM member_news_articles").first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM member_news_sources").first("count")).toBe(0);
  });
  it("keeps foreign markup escaped and returns an honest empty page and valid empty RSS", async () => {
    await source();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(rss("&lt;script&gt;alert(1)&lt;/script&gt;"))),
    );
    await refreshMemberNews(env.DB);
    expect(await renderMemberNews(await read(), [], memberNewsQuerySchema.parse({}))).not.toContain("<script>");
    expect(memberNewsQuerySchema.safeParse({ sort: "unknown" }).success).toBe(false);
    await env.DB.prepare("DELETE FROM member_news_articles").run();
    expect(await renderMemberNews(await read(), [], memberNewsQuerySchema.parse({}))).toContain(
      "No news items available",
    );
    const feed = await renderMemberNewsFeed((await read()).articles, "https://pkic.org");
    expect(new XMLParser().parse(feed, true).rss.channel.item).toBeUndefined();
  });
});
