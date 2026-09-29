import { XMLParser } from "fast-xml-parser";

import type { MemberNewsArticle } from "../../../../assets/shared/schemas/member-news";

export type FeedArticle = Pick<MemberNewsArticle, "url" | "title" | "summary" | "publishedAt">;

const MAX_FEED_BYTES = 1_048_576;
const MAX_ARTICLES = 20;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof record(value)["#text"] === "string"
      ? String(record(value)["#text"])
      : "";
}
function plain(value: unknown): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^<>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key: string) => {
      if (entities[key.toLowerCase()]) return entities[key.toLowerCase()];
      const point = key.startsWith("#x") ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}
function articleUrl(value: unknown, baseUrl: string): string | null {
  try {
    const url = new URL(text(value), baseUrl);
    if (
      !text(value) ||
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** No DTDs or custom entities; malformed, empty, or non-English feeds cannot become articles. */
export function parseMemberFeed(xml: string, baseUrl: string, now = Date.now()): FeedArticle[] {
  if (new TextEncoder().encode(xml).byteLength > MAX_FEED_BYTES || /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
    throw new Error("Unsupported or oversized news feed");
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    stopNodes: ["*.description", "*.summary", "*.content", "*.encoded"],
  }).parse(xml, true);
  const root = record(parsed);
  const channel = record(record(root.rss).channel);
  const atom = record(root.feed);
  const source = Object.keys(channel).length ? channel : atom;
  if (!Object.keys(source).length) throw new Error("Expected an RSS or Atom feed");
  const language = text(source.language || source["@_lang"])
    .slice(0, 2)
    .toLowerCase();
  if (language && language !== "en") return [];
  const raw = source.item ?? source.entry ?? [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const articles = new Map<string, FeedArticle>();
  for (const value of entries) {
    const entry = record(value);
    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const preferred = links.find((link) => !record(link)["@_rel"] || record(link)["@_rel"] === "alternate");
    const url = articleUrl(record(preferred)["@_href"] ?? preferred, baseUrl);
    const title = plain(entry.title).slice(0, 240);
    const summary = plain(entry.description ?? entry.summary ?? entry.content ?? entry.encoded).slice(0, 1200);
    const published = new Date(text(entry.pubDate ?? entry.published ?? entry.updated));
    if (!url || !title || summary.length < 10 || !Number.isFinite(published.getTime()) || published.getTime() > now)
      continue;
    const article = { url, title, summary, publishedAt: published.toISOString() };
    const previous = articles.get(url);
    if (!previous || previous.publishedAt < article.publishedAt) articles.set(url, article);
  }
  return [...articles.values()]
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.url.localeCompare(right.url))
    .slice(0, MAX_ARTICLES);
}

/** Feed retrieval accepts public DNS names only, without credentials or alternate service ports. */
export function validateFeedFetchUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    /\.(localhost|local|internal|invalid)$/.test(host) ||
    url.href.length > 2048
  )
    throw new Error("Feed URL must use a public HTTP or HTTPS host");
  return url;
}

export async function fetchMemberFeed(feedUrl: string): Promise<FeedArticle[]> {
  let url = validateFeedFetchUrl(feedUrl);
  const signal = AbortSignal.timeout(10_000);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("Invalid news feed redirect");
      url = validateFeedFetchUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`News feed returned HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_FEED_BYTES) throw new Error("News feed exceeds the size limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return parseMemberFeed(new TextDecoder("utf-8", { fatal: true }).decode(bytes), url.href);
  }
  throw new Error("Too many news feed redirects");
}
