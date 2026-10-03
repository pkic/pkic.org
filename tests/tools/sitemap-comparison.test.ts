import { describe, expect, it } from "vitest";
import { compareSitemapUrls, readSitemapUrls } from "../../scripts/publication/sitemap-comparison.mjs";

describe("public sitemap migration comparison", () => {
  it("follows child indexes without looping and decodes XML entities", async () => {
    const documents = new Map([
      [
        "https://pkic.org/sitemap.xml",
        "<sitemapindex><sitemap><loc>https://pkic.org/en.xml</loc></sitemap></sitemapindex>",
      ],
      [
        "https://pkic.org/en.xml",
        "<sitemapindex><sitemap><loc>https://pkic.org/sitemap.xml</loc></sitemap><sitemap><loc>https://pkic.org/pages.xml</loc></sitemap></sitemapindex>",
      ],
      [
        "https://pkic.org/pages.xml",
        "<urlset><url><loc>https://pkic.org/members/example/</loc></url><url><loc>https://pkic.org/search/?a=1&amp;b=2</loc></url><url><loc>https://pkic.org/members/example/</loc></url></urlset>",
      ],
    ]);
    const result = await readSitemapUrls(
      "https://pkic.org/sitemap.xml",
      async (url) => new Response(documents.get(String(url))),
    );
    expect(result).toEqual({
      documents: 3,
      urls: ["/members/example/", "/search/?a=1&b=2"],
      duplicates: ["/members/example/"],
    });
  });

  it("reports encoding and slash changes without accepting them as URL parity", () => {
    const report = compareSitemapUrls(
      { urls: ["/caf%C3%A9/", "/members/example/", "/old/"], duplicates: [] },
      { urls: ["/café/", "/members/example", "/new/"], duplicates: [] },
    );
    expect(report.unchangedCount).toBe(0);
    expect(report.missing).toEqual(["/caf%C3%A9/", "/members/example/", "/old/"]);
    expect(report.possibleUrlChanges).toEqual([
      { from: "/caf%C3%A9/", to: "/café/" },
      { from: "/members/example/", to: "/members/example" },
    ]);
  });

  it.each([
    '<!DOCTYPE urlset [<!ENTITY secret SYSTEM "file:///secret">]><urlset/>',
    "<urlset><url></urlset>",
    "<html><body>Not a sitemap</body></html>",
    "<urlset><url><loc>https://another.example/private/</loc></url></urlset>",
    "<urlset><url><lastmod>2026-01-01</lastmod></url></urlset>",
    "<urlset/>",
  ])("rejects unsupported or misleading sitemap documents", async (xml) => {
    await expect(readSitemapUrls("https://pkic.org/sitemap.xml", async () => new Response(xml))).rejects.toThrow();
  });

  it("refuses to treat an error response as an empty successful migration", async () => {
    await expect(
      readSitemapUrls("https://pkic.org/sitemap.xml", async () => new Response("missing", { status: 404 })),
    ).rejects.toThrow("HTTP 404");
  });
});
