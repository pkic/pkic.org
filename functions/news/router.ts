import { Hono } from "hono";
import { memberNewsQuerySchema } from "../../assets/shared/schemas/member-news";
import { readMemberNews, readSponsorNews } from "../_lib/services/member-news/read";
import { renderMemberNews, renderMemberNewsFeed } from "../_lib/services/member-news/render";
import { getStaticAssetsBinding } from "../_lib/static-assets";
import type { Env } from "../_lib/types";

const app = new Hono<{ Bindings: Env }>();
const CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";
app.get("*", async (c) => {
  const url = new URL(c.req.url);
  if (["/news/feed", "/news/feed/", "/news/feed/index.xml"].includes(url.pathname)) {
    const page = await readMemberNews(c.env.DB, memberNewsQuerySchema.parse({ limit: 25 }));
    return new Response(await renderMemberNewsFeed(page.articles, url.origin), {
      headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": CACHE_CONTROL },
    });
  }
  const assets = getStaticAssetsBinding(c.env);
  if (!assets) return c.text("News is temporarily unavailable.", 503);
  if (!["/news", "/news/", "/news/index.html"].includes(url.pathname)) return assets.fetch(c.req.raw);
  const parsed = memberNewsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return c.text("Invalid news page filters.", 400);
  const [shell, page, sponsors] = await Promise.all([
    // The static shell is a different representation: never forward viewer validators or ranges.
    assets.fetch(new Request(new URL("/news/", url))),
    readMemberNews(c.env.DB, parsed.data),
    readSponsorNews(c.env.DB),
  ]);
  if (!shell.ok) return shell;
  const content = await renderMemberNews(page, sponsors, parsed.data);
  const response = new HTMLRewriter()
    .on("[data-member-news]", {
      element(element) {
        element.setInnerContent(content, { html: true });
      },
    })
    .transform(shell);
  const headers = new Headers(response.headers);
  // These validators describe the static shell, not the D1-rendered page.
  for (const name of ["etag", "last-modified", "content-length", "content-range", "accept-ranges", "cf-cache-status"]) {
    headers.delete(name);
  }
  headers.set("cache-control", CACHE_CONTROL);
  return new Response(c.req.method === "HEAD" ? null : response.body, { status: response.status, headers });
});
export default app;
