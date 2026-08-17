/**
 * Canonical flexible-link schema and `links_json` codec. Split out of
 * api.ts so this file has no other relative imports (only `zod`) and can
 * be loaded directly by plain Node tooling (e.g. the member importer)
 * without a bundler — see scripts/migrate-members/sql-renderer.mjs, which
 * is the reason this file must stay dependency-free beyond `zod`.
 */
import { z } from "zod";

function uniqueStringList(values: string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size === values.length;
}

const linkUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Only http/https links are allowed");

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
  return values
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
}

export function serializeLinks(links: string[]): string {
  return JSON.stringify(links);
}

/** Picks the LinkedIn URL out of a canonical links list, for display surfaces that show LinkedIn specifically. */
export function findLinkedinUrl(links: string[]): string | null {
  return links.find((url) => /linkedin\.com/i.test(url)) ?? null;
}
