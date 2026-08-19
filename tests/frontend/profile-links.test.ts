import { describe, expect, it } from "vitest";
import { normalizeProfileLinks } from "../../assets/ts/shared/widgets/profile-links";

// normalizeProfileLinks (P10-R01) is the single canonical normalizer shared by
// every profile-links-editing call site: the admin user editor and admin
// proposal-speaker editor (assets/ts/admin/sections/Users.tsx,
// .../events/detail/ProposalDetailPage.tsx) and the two token-authenticated
// proposal/speaker manage pages (assets/ts/event-flows/proposal-manage-page.tsx,
// .../speaker-manage-page.tsx). Before this consolidation each of those had
// its own near-identical reimplementation; this test proves the one shared
// implementation covers both the plain string[] shape every backend route now
// emits (P10-01) and the legacy object-tolerant shapes some admin response
// types still declare defensively.
describe("normalizeProfileLinks", () => {
  it("passes through an already-normalized string[] response unchanged (the shape every route now emits)", () => {
    expect(normalizeProfileLinks(["https://a.example", "https://b.example"])).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("trims whitespace around plain string entries", () => {
    expect(normalizeProfileLinks(["  https://a.example  ", "https://b.example\n"])).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("extracts the url from legacy {label,url} object entries", () => {
    expect(
      normalizeProfileLinks([
        { label: "LinkedIn", url: "https://linkedin.com/in/example" },
        { url: "https://github.com/example" },
      ]),
    ).toEqual(["https://linkedin.com/in/example", "https://github.com/example"]);
  });

  it("normalizes a mixed array of plain strings and legacy objects identically", () => {
    expect(
      normalizeProfileLinks(["https://a.example", { url: "https://b.example", label: "B" }, "https://c.example"]),
    ).toEqual(["https://a.example", "https://b.example", "https://c.example"]);
  });

  it("drops empty/whitespace-only strings and object entries with no usable url", () => {
    expect(normalizeProfileLinks(["https://a.example", "   ", "", { label: "no url here" }, { url: 42 }])).toEqual([
      "https://a.example",
    ]);
  });

  it("returns [] for a non-array input instead of throwing", () => {
    expect(normalizeProfileLinks(undefined)).toEqual([]);
    expect(normalizeProfileLinks(null)).toEqual([]);
    expect(normalizeProfileLinks("https://a.example")).toEqual([]);
    expect(normalizeProfileLinks({ url: "https://a.example" })).toEqual([]);
  });

  it("does not cap array length (the ProfileLinksInput widget's own max already enforces that)", () => {
    const links = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`);
    expect(normalizeProfileLinks(links)).toHaveLength(20);
  });
});
