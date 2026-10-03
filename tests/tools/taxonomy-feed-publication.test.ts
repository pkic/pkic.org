import { expect, it } from "vitest";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createSiteTaxonomy } from "../../functions/_lib/services/site-taxonomy";
import { createSiteFeed } from "../../functions/_lib/services/site-feed";
import type { ContentDocument } from "../../functions/_lib/services/site-documents";
import { publishedRssResponse } from "../../site/rss";
import { siteTaxonomyFeedHref } from "../../assets/shared/site-feed-url";

function article(index: number, language: "en" | "ms" = "en"): ContentDocument {
  return {
    body: "Published content",
    data: {
      title: `Article ${index} < & >`,
      tags: ["PKI", "PQC"],
      authors: ["Example Author"],
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    },
    isSection: false,
    language,
    nodePath: `blog/article-${index}`,
    route: `${language === "ms" ? "/ms" : ""}/blog/article-${index}/`,
    sourcePath: `content/blog/article-${index}${language === "ms" ? ".ms" : ""}.md`,
  };
}

it("publishes full taxonomy feeds beyond archive page one, deduplicates indexes, and separates languages", () => {
  const documents = [...Array.from({ length: 35 }, (_, index) => article(index)), article(1, "ms")];
  const taxonomy = createSiteTaxonomy({
    documents,
    isPublished: (document) => !document.data.draft,
    listingItem: (document) => ({ title: document.data.title!, href: document.route }),
  });
  const feeds = createSiteFeed({
    datedDocuments: (language) => documents.filter((document) => document.language === language),
    plainSummary: () => "A <safe> description & context",
    titleFor: (document) => document.data.title!,
    taxonomyEntries: (language) => taxonomy.taxonomyEntries(language, { paginate: false }),
  }).siteTaxonomyFeeds();
  const tag = feeds.find((feed) => feed.route === "/feed/tags/pqc/index.xml")!;
  expect(tag.title).toBe("PQC on PKI Consortium");
  expect(tag.items).toHaveLength(30);
  expect(tag.items[0]!.route).toBe("/blog/article-34/");
  expect(tag.items.at(-1)!.route).toBe("/blog/article-5/");
  const index = feeds.find((feed) => feed.route === "/feed/tags/index.xml")!;
  expect(new Set(index.items.map((item) => item.route)).size).toBe(30);
  const localized = feeds.find((feed) => feed.route === "/ms/feed/authors/example-author/index.xml")!;
  expect(localized.items.map((item) => item.route)).toEqual(["/ms/blog/article-1/"]);
  expect(feeds.some((feed) => /\/page\//.test(feed.route))).toBe(false);
});

it("serializes escaped RSS content, canonical links and UTC publication dates with Astro", async () => {
  const document = article(1, "ms");
  const response = await publishedRssResponse({
    title: "PKI < & >",
    description: "A <safe> description & context",
    route: "/ms/feed/tags/pki/index.xml",
    language: "ms",
    items: [{ title: document.data.title!, route: document.route, date: String(document.data.date) }],
  });
  const xml = await response.text();
  expect(XMLValidator.validate(xml)).toBe(true);
  const channel = new XMLParser().parse(xml).rss.channel;
  expect(channel.title).toBe("PKI < & >");
  expect(channel.language).toBe("ms");
  expect(channel.item.title).toBe("Article 1 < & >");
  expect(channel.item.link).toBe("https://pkic.org/ms/blog/article-1/");
  expect(new Date(channel.item.pubDate).toISOString()).toBe("2026-01-02T00:00:00.000Z");
});

it("discovers the same canonical taxonomy feed on archive pagination and localized pages", () => {
  expect(siteTaxonomyFeedHref("/authors/example-author/page/2/")).toBe("/feed/authors/example-author/index.xml");
  expect(siteTaxonomyFeedHref("/ms/tags/pqc/")).toBe("/ms/feed/tags/pqc/index.xml");
  expect(siteTaxonomyFeedHref("/tags/ca/browser-forum/")).toBe("/feed/tags/ca/browser-forum/index.xml");
  expect(siteTaxonomyFeedHref("/tags/")).toBe("/feed/tags/index.xml");
  expect(siteTaxonomyFeedHref("/blog/")).toBeUndefined();
  expect(siteTaxonomyFeedHref("/portal/")).toBeUndefined();
});
