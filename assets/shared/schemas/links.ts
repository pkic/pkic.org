/**
 * Canonical flexible-link schema and `links_json` codec. Split out of
 * api.ts so it and its URL primitive dependency can be loaded directly by
 * plain Node tooling (e.g. the member importer) without a bundler — see
 * scripts/migrate-members/sql-renderer.mjs.
 */
import { z } from "zod";
import { httpUrlSchema, sanitizeLegacyHttpUrl } from "./urls.ts";

function uniqueStringList(values: string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

export const linkUrlSchema = httpUrlSchema;

/** Canonical maximum number of flexible profile links persisted per record. */
export const MAX_LINKS = 15;

/** Canonical site labels and stable mark identifiers; social icon artwork is shared with Hugo. */
export interface LinkHost {
  label: string;
  mark: string;
}

const OUTBOUND_MARK = "↗";

export const LINK_HOSTS: Readonly<Record<string, LinkHost>> = {
  "linkedin.com": { label: "LinkedIn", mark: "in" },
  "xing.com": { label: "Xing", mark: "xi" },
  "orcid.org": { label: "ORCID", mark: "id" },
  "researchgate.net": { label: "ResearchGate", mark: "rg" },
  "scholar.google.com": { label: "Google Scholar", mark: "gs" },
  "academia.edu": { label: "Academia.edu", mark: "ac" },
  "semanticscholar.org": { label: "Semantic Scholar", mark: "s2" },
  "ssrn.com": { label: "SSRN", mark: "ss" },
  "papers.ssrn.com": { label: "SSRN", mark: "ss" },
  "arxiv.org": { label: "arXiv", mark: "ar" },
  "zenodo.org": { label: "Zenodo", mark: "ze" },
  "figshare.com": { label: "Figshare", mark: "fs" },
  "datatracker.ietf.org": { label: "IETF Datatracker", mark: "df" },
  "ieee.org": { label: "IEEE", mark: "ie" },
  "dl.acm.org": { label: "ACM Digital Library", mark: "dl" },
  "github.com": { label: "GitHub", mark: "gh" },
  "gitlab.com": { label: "GitLab", mark: "gl" },
  "twitter.com": { label: "X (Twitter)", mark: "x" },
  "x.com": { label: "X (Twitter)", mark: "x" },
  "bsky.app": { label: "Bluesky", mark: "bs" },
  "youtube.com": { label: "YouTube", mark: "yt" },
  "facebook.com": { label: "Facebook", mark: "fb" },
  "instagram.com": { label: "Instagram", mark: "ig" },
  "mastodon.social": { label: "Mastodon", mark: "@" },
  "en.wikipedia.org": { label: "Wikipedia", mark: "wp" },
};

/** A Mastodon instance announces itself in the path, not the host. */
const MASTODON_PATH = /^\/@[^/]+\/?$/;

/**
 * What the system knows about the site a URL points at.
 *
 * A URL it cannot even parse is not a link to somewhere — it is a string, and
 * the honest label for it is itself.
 */
function describeLinkHost(url: string): LinkHost {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { label: url, mark: OUTBOUND_MARK };
  }
  if (parsed.protocol === "mailto:") {
    // The address is the name here; `mailto:` is scaffolding.
    return { label: parsed.pathname, mark: "@" };
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const known = LINK_HOSTS[hostname];
  if (known) return known;
  if (MASTODON_PATH.test(parsed.pathname)) return { label: hostname, mark: "@" };
  return { label: hostname, mark: OUTBOUND_MARK };
}

export const linksSchema = z
  .array(linkUrlSchema)
  .max(MAX_LINKS)
  .superRefine((values, ctx) => {
    if (!uniqueStringList(values)) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate links are not allowed",
      });
    }
  });

export interface NormalizeLinksResult {
  links: string[];
  rejected: unknown[];
}

/** Strict client-safe parser for a single persisted link. */
export function parseLinkUrl(value: unknown): string | null {
  const parsed = linkUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Case-insensitive duplicate check shared by every links editor. */
export function hasDuplicateLink(links: readonly string[], candidate: string): boolean {
  const key = candidate.trim().toLowerCase();
  return links.some((link) => link.trim().toLowerCase() === key);
}

/** Human-readable label shared by profile-link editors and public profile views. */
export function getLinkLabel(url: string): string {
  return describeLinkHost(url).label;
}

/** The two-character mark a link is drawn behind, from the same table. */
export function getLinkMark(url: string): string {
  return describeLinkHost(url).mark;
}

/**
 * Canonical tolerant normalizer used by legacy readers and import tooling.
 * It applies the exact persisted-link URL, uniqueness, and cardinality rules
 * without allowing one malformed historic entry to hide the valid entries.
 */
export function normalizeLinks(values: readonly unknown[]): NormalizeLinksResult {
  const links: string[] = [];
  const rejected: unknown[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = sanitizeLegacyHttpUrl(value);
    const key = url?.toLowerCase();
    if (!url || !key || seen.has(key) || links.length >= MAX_LINKS) {
      rejected.push(value);
      continue;
    }
    seen.add(key);
    links.push(url);
  }
  return { links, rejected };
}

/**
 * Canonical `links_json` codec — every writer/reader of a persisted links
 * column (users.links_json; formerly organizations' per-provider social_*
 * columns) goes through this instead of re-parsing raw JSON. `parseLinksJson`
 * also tolerates two legacy shapes so it degrades gracefully on any row a
 * migration missed, rather than silently dropping the link: the
 * `{linkedin, x}` object written by the original YAML migration and older
 * service code, and the older `[{label, url}]` array-of-link-objects shape
 * that predates the plain-string-array convention.
 */
export function parseLinksJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? Object.values(parsed) : [];
  const candidates = values
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const { url, label } = entry as { url?: unknown; label?: unknown };
        if (typeof url === "string") return url;
        if (typeof label === "string") return label;
      }
      return "";
    })
    .map((url) => url.trim())
    .filter(Boolean);

  return normalizeLinks(candidates).links;
}

export function serializeLinks(links: string[]): string {
  return JSON.stringify(linksSchema.parse(links));
}

/**
 * The owner-ordered featured link: the first entry of a canonical links list,
 * whatever its platform. The links schema deliberately hardcodes no platform —
 * the owner expresses preference by ordering the list, and display surfaces
 * with room for one highlighted profile link show this one, labeled by
 * `getLinkLabel`.
 */
export function getFeaturedLink(links: readonly string[]): string | null {
  return links[0] ?? null;
}
