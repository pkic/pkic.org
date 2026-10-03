import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_SITEMAP_BYTES = 5_242_880;
const MAX_SITEMAPS = 64;
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });
const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** Follow one site's sitemap tree; preserve URL spelling for migration comparisons. */
export async function readSitemapUrls(root, fetchDocument = fetch) {
  const origin = new URL(root).origin;
  const pending = [root];
  const visited = new Set();
  const urls = new Set();
  const duplicates = new Set();
  while (pending.length) {
    const address = pending.shift();
    if (visited.has(address)) continue;
    if (visited.size >= MAX_SITEMAPS) throw new Error("Sitemap tree exceeds the document limit");
    visited.add(address);
    const response = await fetchDocument(address, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error(`Sitemap returned HTTP ${response.status}: ${address}`);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_SITEMAP_BYTES) throw new Error(`Sitemap exceeds the byte limit: ${address}`);
      chunks.push(chunk);
    }
    const xml = new TextDecoder().decode(Buffer.concat(chunks));
    if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new Error(`Invalid or unsupported sitemap XML: ${address}`);
    const document = parser.parse(xml);
    const index = document.sitemapindex;
    const urlset = document.urlset;
    if ((index === undefined) === (urlset === undefined)) throw new Error(`Expected one sitemap root: ${address}`);
    const entries = list(index?.sitemap ?? urlset?.url);
    for (const entry of entries) {
      if (typeof entry.loc !== "string") throw new Error(`Missing sitemap location: ${address}`);
      const location = new URL(entry.loc);
      if (location.origin !== origin || location.hash || location.username || location.password)
        throw new Error(`Sitemap location must belong to the same site: ${entry.loc}`);
      if (index !== undefined) pending.push(location.href);
      else {
        // Compare hosts separately from paths, so a preview can be compared with production.
        const path = `${location.pathname}${location.search}`;
        if (urls.has(path)) duplicates.add(path);
        urls.add(path);
      }
    }
  }
  if (!urls.size) throw new Error("Sitemap tree contains no public URLs");
  return { urls: [...urls].sort(), duplicates: [...duplicates].sort(), documents: visited.size };
}

function spellingKey(path) {
  try {
    return decodeURI(path).normalize("NFC").replace(/\/$/, "");
  } catch {
    return path;
  }
}

/** Similar spellings remain missing URLs until an explicit redirect is implemented. */
export function compareSitemapUrls(baseline, candidate) {
  const previous = new Set(baseline.urls);
  const next = new Set(candidate.urls);
  const missing = baseline.urls.filter((path) => !next.has(path));
  const added = candidate.urls.filter((path) => !previous.has(path));
  const variants = new Map();
  for (const path of added) {
    const key = spellingKey(path);
    variants.set(key, [...(variants.get(key) ?? []), path]);
  }
  return {
    baselineCount: previous.size,
    candidateCount: next.size,
    unchangedCount: baseline.urls.filter((path) => next.has(path)).length,
    missing,
    added,
    possibleUrlChanges: missing.flatMap((from) => (variants.get(spellingKey(from)) ?? []).map((to) => ({ from, to }))),
    duplicateUrls: { baseline: baseline.duplicates, candidate: candidate.duplicates },
  };
}
