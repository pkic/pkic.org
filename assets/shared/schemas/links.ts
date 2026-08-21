/**
 * Canonical flexible-link schema and `links_json` codec. Split out of
 * api.ts so it and its URL primitive dependency can be loaded directly by
 * plain Node tooling (e.g. the member importer) without a bundler — see
 * scripts/migrate-members/sql-renderer.mjs.
 */
import { z } from "zod";
import { hasUrlHostname, httpUrlSchema, sanitizeLegacyHttpUrl } from "./urls";

function uniqueStringList(values: string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

export const linkUrlSchema = httpUrlSchema;

export const linksSchema = z
  .array(linkUrlSchema)
  .max(15)
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
    if (!url || !key || seen.has(key) || links.length >= 15) {
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

/** Picks the LinkedIn URL out of a canonical links list, for display surfaces that show LinkedIn specifically. */
export function findLinkedinUrl(links: string[]): string | null {
  return links.find((url) => hasUrlHostname(url, "linkedin.com")) ?? null;
}
