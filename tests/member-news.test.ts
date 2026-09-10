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
import newsRouter from "../functions/news/router";
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
    const assets = {
      fetch: vi.fn(
        async () =>
          new Response("<main><div data-member-news></div></main>", { headers: { "content-type": "text/html" } }),
      ),
    };
    const htmlResponse = await newsRouter.request(
      "https://portal.example.test/news/?limit=2",
      {},
      { ...env, ASSETS: assets },
    );
    const html = await htmlResponse.text();
    expect(html).toContain("Certificates &amp; trust");
    expect(html).toContain("Older articles");
    expect(html).toContain("data-local-time-date-only");
    expect(html).toContain("Sponsor Highlights");
    expect(htmlResponse.headers.get("cache-control")).toContain("s-maxage=900");
    const feedResponse = await newsRouter.request("https://portal.example.test/news/feed/", {}, env);
    const parsed = new XMLParser().parse(await feedResponse.text(), true);
    expect(parsed.rss.channel.item).toHaveLength(3);
    expect(parsed.rss.channel.item[0].title).toBe(page.articles[0].title);
    expect(feedResponse.headers.get("content-type")).toContain("application/rss+xml");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await refreshMemberNews(env.DB)).summary.refreshed).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not reuse static-shell validators for changing D1 content and supports HEAD", async () => {
    await source();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(rss())),
    );
    await refreshMemberNews(env.DB);
    await env.DB.prepare("UPDATE member_news_articles SET title = 'Updated article'").run();
    const shellFetch = vi.fn(async (request: Request) => {
      if (request.headers.has("if-none-match")) return new Response(null, { status: 304 });
      expect(request.method).toBe("GET");
      expect(request.headers.has("range")).toBe(false);
      return new Response("<div data-member-news></div>", {
        headers: {
          "content-type": "text/html",
          etag: '"static-shell"',
          "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
        },
      });
    });
    const bindings = { ...env, ASSETS: { fetch: shellFetch } };
    const response = await newsRouter.request(
      "https://portal.example.test/news/",
      {
        headers: { "if-none-match": '"static-shell"', range: "bytes=0-10" },
      },
      bindings,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Updated article");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
    const head = await newsRouter.request("https://portal.example.test/news/", { method: "HEAD" }, bindings);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("cache-control")).toContain("s-maxage=900");
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
    const assets = {
      fetch: async () => new Response("<div data-member-news></div>", { headers: { "content-type": "text/html" } }),
    };
    const response = await newsRouter.request("https://portal.example.test/news/", {}, { ...env, ASSETS: assets });
    expect(await response.text()).not.toContain("<script>");
    expect((await newsRouter.request("https://portal.example.test/news/?sort=unknown", {}, env)).status).toBe(400);
    await env.DB.prepare("DELETE FROM member_news_articles").run();
    const empty = await newsRouter.request("https://portal.example.test/news/", {}, { ...env, ASSETS: assets });
    expect(await empty.text()).toContain("No news items available");
    const feed = await newsRouter.request("https://portal.example.test/news/feed/index.xml", {}, env);
    expect(new XMLParser().parse(await feed.text(), true).rss.channel.item).toBeUndefined();
  });
});
