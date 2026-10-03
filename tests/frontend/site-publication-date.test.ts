import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, it } from "vitest";
import { ContentPage } from "../../assets/ts/site/SitePages";
import { BlogHeroMeta } from "../../assets/ts/site/BlogPost";

it("omits publication dates from ordinary page heroes", () => {
  const html = renderToString(
    h(ContentPage, {
      hero: { title: "Join the PKI Consortium", tone: "default" },
      html: "<p>Become a member.</p>",
      meta: { date: "2021-01-08T14:49:10.000Z" },
    }),
  );
  expect(html).not.toContain("<time");
  expect(html).not.toContain("pk-public-article-meta");
});

it("retains publication dates on blog and news article heroes", () => {
  const html = renderToString(
    h(BlogHeroMeta, {
      date: "2021-01-08T14:49:10.000Z",
      sidebar: { language: "en", authors: [], related: [], tags: [], readingTime: 2 },
    }),
  );
  expect(html).toContain("<time");
  expect(html).toContain("2021-01-08T14:49:10.000Z");
});
