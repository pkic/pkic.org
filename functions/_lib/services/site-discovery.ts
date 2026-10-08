import { siteFeedItems, siteMapEntries } from "./site-content";
import { all } from "../db/queries";
import type { Env } from "../types";
import type { SiteMapEntry } from "../../../assets/shared/site-content";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { memberProfileHref } from "../../../assets/shared/member-profile-url";
import { publishedSessionHistory, publishedSpeakerHistory } from "./site-session-history";
import { publishedEventAgendas } from "./site-published-event-agendas";

const DISCOVERY_PATHS = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/en/sitemap.xml",
  "/ms/sitemap.xml",
  "/feed/blog/",
  "/feed/blog/index.xml",
]);

const BLOG_FEED_PATH = "/feed/blog/index.xml";

const FEED_REDIRECTS = new Set(["/feed", "/feed/", "/blog/feed", "/blog/feed/", "/feed/blog"]);

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizedDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function discoveryHeaders(contentType: string): HeadersInit {
  return {
    "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };
}

async function memberSitemapEntries(env: Env): Promise<SiteMapEntry[]> {
  const rows = await all<{ slug: string }>(
    env.DB,
    `SELECT DISTINCT organization.slug
       FROM members member
       JOIN organizations organization ON organization.id = member.organization_id
      WHERE member.status = 'active'
        AND organization.slug IS NOT NULL
        AND organization.slug != ''
      ORDER BY organization.slug`,
  );
  return rows.map((row) => ({ route: `/members/${encodeURIComponent(row.slug)}/` }));
}

/** Build-only discovery derives archive dates from the same approved content as the pages. */
export function publishedSnapshotSitemapEntries(publication: SitePublicationSnapshot): SiteMapEntry[] {
  return [
    { route: "/sessions/" },
    ...publishedSessionHistory(publication).map(({ route, lastmod }) => ({ route, lastModified: lastmod })),
    ...publishedSpeakerHistory(publication).map((person) => ({
      route: person.route,
      lastModified: person.appearances
        .flatMap(({ lastmod }) => (lastmod ? [lastmod] : []))
        .sort()
        .at(-1),
    })),
    ...publication.members.map((member) => ({ route: memberProfileHref(member) })),
    ...publishedEventAgendas(publication).map(({ route }) => ({ route })),
  ];
}

function sitemapIndexResponse(request: Request): Response {
  const origin = new URL(request.url).origin;
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap>\n    <loc>${escapeXml(
    new URL("/en/sitemap.xml", origin).toString(),
  )}</loc>\n  </sitemap>\n  <sitemap>\n    <loc>${escapeXml(
    new URL("/ms/sitemap.xml", origin).toString(),
  )}</loc>\n  </sitemap>\n</sitemapindex>\n`;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: discoveryHeaders("application/xml; charset=UTF-8"),
  });
}

function sitemapResponse(request: Request, language: "en" | "ms", members: readonly SiteMapEntry[]): Response {
  const origin = new URL(request.url).origin;
  const dynamicEntries = language === "en" ? members : [];
  const entries = new Map(siteMapEntries(language).map((entry) => [entry.route, entry]));
  for (const entry of dynamicEntries) entries.set(entry.route, entry);
  const urls = [...entries.values()]
    .map((entry) => {
      const location = escapeXml(new URL(entry.route, origin).toString());
      const lastModified = normalizedDate(entry.lastModified);
      return `  <url>\n    <loc>${location}</loc>${
        lastModified ? `\n    <lastmod>${escapeXml(lastModified)}</lastmod>` : ""
      }\n  </url>`;
    })
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: discoveryHeaders("application/xml; charset=UTF-8"),
  });
}

function robotsResponse(request: Request, allowIndexing?: boolean): Response {
  const url = new URL(request.url);
  const production = allowIndexing ?? (url.hostname === "pkic.org" || url.hostname === "www.pkic.org");
  const lines = production
    ? ["User-agent: *", "Allow: /", `Sitemap: ${url.origin}/sitemap.xml`]
    : ["User-agent: *", "Disallow: /"];
  return new Response(request.method === "HEAD" ? null : `${lines.join("\n")}\n`, {
    headers: discoveryHeaders("text/plain; charset=UTF-8"),
  });
}

function blogFeedResponse(request: Request): Response {
  const origin = new URL(request.url).origin;
  const channelUrl = new URL("/blog/", origin).toString();
  const selfUrl = new URL("/feed/blog/", origin).toString();
  const items = siteFeedItems()
    .map((item) => {
      const itemUrl = new URL(item.route, origin).toString();
      const published = normalizedDate(item.date);
      const authors = (item.authors ?? [])
        .map((author) => `      <dc:creator>${escapeXml(author)}</dc:creator>`)
        .join("\n");
      return `    <item>\n      <title>${escapeXml(item.title)}</title>\n      <link>${escapeXml(
        itemUrl,
      )}</link>\n      <guid isPermaLink="true">${escapeXml(itemUrl)}</guid>${
        published ? `\n      <pubDate>${new Date(published).toUTCString()}</pubDate>` : ""
      }${item.description ? `\n      <description>${escapeXml(item.description)}</description>` : ""}${
        authors ? `\n${authors}` : ""
      }\n    </item>`;
    })
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n  <channel>\n    <title>PKI Consortium blog</title>\n    <link>${escapeXml(
    channelUrl,
  )}</link>\n    <description>Updates from the PKI Consortium</description>\n    <language>en-us</language>\n    <atom:link href="${escapeXml(
    selfUrl,
  )}" rel="self" type="application/rss+xml" />\n${items}\n  </channel>\n</rss>\n`;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: discoveryHeaders("application/rss+xml; charset=UTF-8"),
  });
}

/** Static releases retain every legacy feed URL as an edge redirect. */
export function siteDiscoveryRedirectEntries(): Array<{ from: string; to: string }> {
  return [...FEED_REDIRECTS, "/feed/blog/"].map((from) => ({ from, to: BLOG_FEED_PATH }));
}

export function isSiteDiscoveryPath(pathname: string): boolean {
  return DISCOVERY_PATHS.has(pathname) || FEED_REDIRECTS.has(pathname);
}

export function renderPublishedDiscovery(
  request: Request,
  members: readonly SiteMapEntry[],
  options: { allowIndexing?: boolean } = {},
): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { headers: { allow: "GET, HEAD" }, status: 405 });
  }
  const pathname = new URL(request.url).pathname;
  if (FEED_REDIRECTS.has(pathname)) return Response.redirect(new URL(BLOG_FEED_PATH, request.url).toString(), 301);
  if (pathname === "/robots.txt") return robotsResponse(request, options.allowIndexing);
  if (pathname === "/sitemap.xml") return sitemapIndexResponse(request);
  if (pathname === "/en/sitemap.xml") return sitemapResponse(request, "en", members);
  if (pathname === "/ms/sitemap.xml") return sitemapResponse(request, "ms", members);
  return blogFeedResponse(request);
}

export async function serveSiteDiscoveryRequest(request: Request, env: Env): Promise<Response> {
  const members = new URL(request.url).pathname === "/en/sitemap.xml" ? await memberSitemapEntries(env) : [];
  return renderPublishedDiscovery(request, members);
}
