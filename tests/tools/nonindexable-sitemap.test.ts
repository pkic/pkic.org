import { expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { excludeNonindexableSitemapEntries } from "../../scripts/publication/exclude-nonindexable-sitemap-entries.mjs";

it("excludes rendered noindex routes from generated discovery without losing public entries", () => {
  const xml =
    '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://pkic.org/events/conference/</loc><lastmod>2026-10-02</lastmod></url><url><loc>https://pkic.org/events/conference/event-speakers/</loc></url><url><loc>https://pkic.org/application-status/</loc></url><url><loc>https://pkic.org/members/current/</loc></url></urlset>';
  const result = excludeNonindexableSitemapEntries(xml, ["/events/conference/event-speakers/", "/application-status/"]);
  const dom = new JSDOM(result, { contentType: "text/xml" });
  try {
    expect(Array.from(dom.window.document.getElementsByTagName("loc"), (item) => item.textContent)).toEqual([
      "https://pkic.org/events/conference/",
      "https://pkic.org/members/current/",
    ]);
    expect(dom.window.document.getElementsByTagName("lastmod")[0]!.textContent).toBe("2026-10-02");
    expect(excludeNonindexableSitemapEntries(result, ["/application-status/"])).toBe(result);
  } finally {
    dom.window.close();
  }
});
