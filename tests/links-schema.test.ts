/**
 * Phase 3 §3.5: parseLinksJson tolerantly normalizes legacy links_json
 * shapes but previously returned the result unchecked against linksSchema
 * — a row with 40 links, a non-URL string smuggled in via the tolerant
 * {label, url} fallback, or a duplicate link would pass through untouched.
 * These assert parseLinksJson's output now always satisfies linksSchema,
 * for every legacy shape it tolerates, deliberately malformed included.
 */
import { describe, expect, it } from "vitest";
import {
  getFeaturedLink,
  getLinkLabel,
  hasDuplicateLink,
  MAX_LINKS,
  linksSchema,
  normalizeLinks,
  parseLinkUrl,
  parseLinksJson,
  serializeLinks,
} from "../assets/shared/schemas/links";

function expectConformant(raw: string): string[] {
  const result = parseLinksJson(raw);
  const parsed = linksSchema.safeParse(result);
  expect(parsed.success, `parseLinksJson output failed linksSchema: ${JSON.stringify(result)}`).toBe(true);
  return result;
}

describe("parseLinksJson self-validation (Phase 3 §3.5)", () => {
  it("returns [] for null/undefined/empty/invalid JSON", () => {
    expect(parseLinksJson(null)).toEqual([]);
    expect(parseLinksJson(undefined)).toEqual([]);
    expect(parseLinksJson("")).toEqual([]);
    expect(parseLinksJson("not json")).toEqual([]);
  });

  it("passes through a canonical plain string array unchanged", () => {
    const raw = serializeLinks(["https://example.com/a", "https://example.com/b"]);
    expect(expectConformant(raw)).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("rejects invalid values at the canonical persistence boundary", () => {
    expect(() => serializeLinks(["javascript:alert(1)"])).toThrow();
    expect(() => serializeLinks(["https://example.com", "https://EXAMPLE.com"])).toThrow();
  });

  it("normalizes the legacy {linkedin, x} object shape", () => {
    const raw = JSON.stringify({ linkedin: "https://linkedin.com/in/x", x: "https://x.com/y" });
    expect(expectConformant(raw).sort()).toEqual(["https://linkedin.com/in/x", "https://x.com/y"].sort());
  });

  it("normalizes the legacy [{label, url}] array-of-objects shape", () => {
    const raw = JSON.stringify([{ label: "Site", url: "https://example.com" }]);
    expect(expectConformant(raw)).toEqual(["https://example.com"]);
  });

  it("drops a non-URL string smuggled in via the {label} fallback instead of passing it through", () => {
    const raw = JSON.stringify([{ label: "not a url at all" }, { url: "https://example.com/real" }]);
    const result = expectConformant(raw);
    expect(result).toEqual(["https://example.com/real"]);
  });

  it("drops a non-http(s) scheme (e.g. javascript:) instead of passing it through", () => {
    const raw = JSON.stringify(["javascript:alert(1)", "https://example.com/safe"]);
    const result = expectConformant(raw);
    expect(result).toEqual(["https://example.com/safe"]);
  });

  it("dedupes case-insensitive duplicates instead of passing both through", () => {
    const raw = JSON.stringify(["https://Example.com/a", "https://example.com/A"]);
    const result = expectConformant(raw);
    expect(result).toEqual(["https://Example.com/a"]);
  });

  it(`caps an oversized legacy row (40 links) at ${MAX_LINKS} instead of passing all 40 through`, () => {
    const urls = Array.from({ length: 40 }, (_, i) => `https://example.com/link-${i}`);
    const raw = JSON.stringify(urls);
    const result = expectConformant(raw);
    expect(result).toHaveLength(MAX_LINKS);
    expect(result).toEqual(urls.slice(0, MAX_LINKS));
  });

  it("uses the same tolerant normalizer for invalid, duplicate, and over-limit entries", () => {
    const values = [" https://example.com/a ", "javascript:alert(1)", "HTTPS://EXAMPLE.COM/A"];
    const normalized = normalizeLinks(values);
    expect(normalized.links).toEqual(["https://example.com/a"]);
    expect(normalized.rejected).toEqual(["javascript:alert(1)", "HTTPS://EXAMPLE.COM/A"]);
  });

  it("features the owner's first link, whatever its platform", () => {
    // The owner orders the canonical list; no platform is special-cased, so a
    // list that ranks another site above a well-known network still features
    // the first entry.
    expect(getFeaturedLink(["https://github.com/alice", "https://www.linkedin.com/in/alice"])).toBe(
      "https://github.com/alice",
    );
    expect(getFeaturedLink(["https://www.linkedin.com/in/alice"])).toBe("https://www.linkedin.com/in/alice");
    expect(getFeaturedLink([])).toBeNull();
  });

  it("shares strict client URL validation with the persistence schema", () => {
    expect(parseLinkUrl("  https://example.com/profile  ")).toBe("https://example.com/profile");
    expect(parseLinkUrl("https://user:password@example.com/profile")).toBeNull();
    expect(parseLinkUrl("javascript:alert(1)")).toBeNull();
  });

  it("shares case-insensitive duplicate detection with the persistence schema", () => {
    expect(hasDuplicateLink(["https://Example.com/profile"], "HTTPS://example.com/profile")).toBe(true);
    expect(hasDuplicateLink(["https://example.com/profile"], "https://example.com/other")).toBe(false);
  });

  it("shares the canonical link maximum", () => {
    const links = Array.from({ length: MAX_LINKS }, (_, index) => `https://example.com/${index}`);
    expect(linksSchema.safeParse(links).success).toBe(true);
    expect(linksSchema.safeParse([...links, "https://example.com/overflow"]).success).toBe(false);
  });

  it("shares labels between editors and profile views", () => {
    expect(getLinkLabel("https://www.linkedin.com/in/example")).toBe("LinkedIn");
    expect(getLinkLabel("https://facebook.com/example")).toBe("Facebook");
    expect(getLinkLabel("https://unknown.example/profile")).toBe("unknown.example");
  });
});
