import { describe, expect, it } from "vitest";
import { firstFreeSlug, slugify, slugifyOr } from "../assets/shared/slug";

/*
 * The rules five copies of this function had each half-implemented.
 *
 * Every case below is one that at least one of the removed copies got
 * differently: trimming, a run of leading punctuation rather than a single
 * character, the length cap, and what a name in a non-Latin script produces.
 */
describe("slugify", () => {
  it("lower-cases, collapses every non-alphanumeric run, and trims the ends", () => {
    expect(slugify("  PKI Consortium — Working Group #2!  ")).toBe("pki-consortium-working-group-2");
  });

  it("strips a run of leading and trailing separators, not just one", () => {
    expect(slugify("--- Hello ---")).toBe("hello");
    expect(slugify("...Keyfactor...")).toBe("keyfactor");
  });

  it("reduces to nothing rather than guessing when there is no ASCII to keep", () => {
    // No transliteration: a slug of mojibake is worse than no slug, and every
    // caller has a fallback of its own.
    expect(slugify("日本語")).toBe("");
    expect(slugifyOr("日本語", "member")).toBe("member");
    expect(slugifyOr("Keyfactor", "member")).toBe("keyfactor");
  });

  it("cuts to the requested length without leaving a trailing separator", () => {
    // "aaaa-bbbb" cut at 5 would end on the hyphen, which the shape forbids.
    expect(slugify("aaaa bbbb", { maxLength: 5 })).toBe("aaaa");
    expect(slugify("aaaa bbbb", { maxLength: 6 })).toBe("aaaa-b");
  });

  it("caps at 200 characters by default", () => {
    expect(slugify("a".repeat(500))).toHaveLength(200);
  });
});

describe("firstFreeSlug", () => {
  it("returns the base when nothing holds it", async () => {
    expect(await firstFreeSlug("keyfactor", async () => false)).toBe("keyfactor");
  });

  it("counts up from 2 past every taken candidate", async () => {
    const taken = new Set(["keyfactor", "keyfactor-2", "keyfactor-3"]);
    expect(await firstFreeSlug("keyfactor", async (candidate) => taken.has(candidate))).toBe("keyfactor-4");
  });

  it("gives up rather than looping forever", async () => {
    await expect(firstFreeSlug("keyfactor", async () => true, 3)).rejects.toThrow(/within 3 attempts/);
  });
});
