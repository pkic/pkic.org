import { expect, it } from "vitest";
import { memberNewsArticleSchema } from "../../assets/shared/schemas/member-news";
import { newsPageSize, publishedNewsPages } from "../../site/news-pages";

it("publishes every cached article once across bounded pages, including the final partial page", () => {
  const articles = Array.from({ length: newsPageSize + 1 }, (_, index) =>
    memberNewsArticleSchema.parse({
      organizationId: "synthetic-publisher",
      organizationName: "Synthetic publisher",
      url: `https://example.test/article-${index}`,
      title: `Published article ${index}`,
      summary: "Synthetic article summary",
      publishedAt: "2026-09-29T00:00:00.000Z",
      sponsorTier: null,
    }),
  );
  const pages = publishedNewsPages(articles);
  expect(pages.map((entry) => entry.route)).toEqual(["/news/", "/news/page/2/"]);
  expect(pages[0]!.page.page.hasMore).toBe(true);
  expect(pages[1]!.page.page.hasMore).toBe(false);
  expect(pages[1]!.page.articles).toHaveLength(1);
  expect(pages.flatMap((entry) => entry.page.articles)).toEqual(articles);
});

it("publishes an honest empty news page with the canonical empty page contract", () => {
  const pages = publishedNewsPages([]);
  expect(pages).toHaveLength(1);
  expect(pages[0]!.route).toBe("/news/");
  expect(pages[0]!.page.articles).toEqual([]);
  expect(pages[0]!.page.page).toMatchObject({ total: 0, hasMore: false });
});
