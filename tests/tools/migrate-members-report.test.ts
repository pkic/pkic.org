import { describe, expect, it } from "vitest";
import { repSummary, formatRep, renderMarkdownReport } from "../../scripts/migrate-members/report.mjs";

describe("repSummary", () => {
  it("extracts name/role/linkedin/bio, defaulting missing fields to null", () => {
    expect(repSummary({ name: "Alice", role: "CEO", social: { linkedin: "https://linkedin.com/in/alice" } })).toEqual({
      name: "Alice",
      role: "CEO",
      linkedin: "https://linkedin.com/in/alice",
      bio: null,
    });
    expect(repSummary({ name: "Bob" })).toEqual({ name: "Bob", role: null, linkedin: null, bio: null });
  });
});

describe("formatRep", () => {
  it("appends role/linkedin in parens when present, bare name otherwise", () => {
    expect(formatRep({ name: "Alice", role: "CEO", linkedin: "https://linkedin.com/in/alice" })).toBe(
      "Alice (CEO, https://linkedin.com/in/alice)",
    );
    expect(formatRep({ name: "Bob", role: null, linkedin: null })).toBe("Bob");
  });
});

describe("renderMarkdownReport", () => {
  it("renders the summary counts and each report section for an empty report", () => {
    const report = {
      generatedAt: "2026-08-16T00:00:00.000Z",
      totals: {
        yamlFiles: 0,
        matchedOrgs: 0,
        sentinelIndividuals: 0,
        unmatched: [],
        missingCategory: [],
        ambiguousPairing: [],
      },
      needsEmailIndividuals: [],
      bareRosterUsers: [],
      wgOnlyRosterUsers: [],
      unmatchedEventSponsorships: [],
      nonMemberSponsorships: { created: 0, unmatchedEvents: [] },
      workingGroupCounts: { ca: 0 },
    };
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("# Member migration report (2026-08-16T00:00:00.000Z)");
    expect(markdown).toContain("YAML files processed: 0");
    expect(markdown).toContain("- ca: 0");
  });

  it("includes an unmatched organization's reason and representative summaries", () => {
    const report = {
      generatedAt: "2026-08-16T00:00:00.000Z",
      totals: {
        yamlFiles: 1,
        matchedOrgs: 0,
        sentinelIndividuals: 0,
        unmatched: [
          {
            file: "acme.yaml",
            name: "Acme Corp",
            memberType: "A",
            representatives: [{ name: "Alice", role: "CEO", linkedin: null, bio: null }],
            reason: "no roster subscriber at this domain",
            workingGroupsHint: [],
          },
        ],
        missingCategory: [],
        ambiguousPairing: [],
      },
      needsEmailIndividuals: [],
      bareRosterUsers: [],
      wgOnlyRosterUsers: [],
      unmatchedEventSponsorships: [],
      nonMemberSponsorships: { created: 0, unmatchedEvents: [] },
      workingGroupCounts: {},
    };
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("**Acme Corp** (`acme.yaml`, category A) — no roster subscriber at this domain");
    expect(markdown).toContain("Alice (CEO)");
  });
});
