import { describe, expect, it } from "vitest";
import { repSummary, formatRep, renderMarkdownReport } from "../../scripts/migrate-members/report.mjs";

interface ReportTotals {
  yamlFiles: number;
  matchedOrgs: number;
  sentinelIndividuals: number;
  unmatched: unknown[];
  missingCategory: unknown[];
  ambiguousPairing: unknown[];
}

interface ReportFixture {
  generatedAt: string;
  totals: ReportTotals;
  needsEmailIndividuals: unknown[];
  bareRosterUsers: unknown[];
  wgOnlyRosterUsers: unknown[];
  invalidLinks: unknown[];
  unmatchedEventSponsorships: unknown[];
  nonMemberSponsorships: { created: number; unmatchedEvents: unknown[] };
  workingGroupCounts: Record<string, number>;
}

function reportFixture(
  overrides: Partial<Omit<ReportFixture, "totals">> & { totals?: Partial<ReportTotals> } = {},
): ReportFixture {
  return {
    generatedAt: "2026-08-16T00:00:00.000Z",
    needsEmailIndividuals: [],
    bareRosterUsers: [],
    wgOnlyRosterUsers: [],
    invalidLinks: [],
    unmatchedEventSponsorships: [],
    nonMemberSponsorships: { created: 0, unmatchedEvents: [] },
    workingGroupCounts: {},
    ...overrides,
    totals: {
      yamlFiles: 0,
      matchedOrgs: 0,
      sentinelIndividuals: 0,
      unmatched: [],
      missingCategory: [],
      ambiguousPairing: [],
      ...overrides.totals,
    },
  };
}

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
    const report = reportFixture({ workingGroupCounts: { ca: 0 } });
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("# Member migration report (2026-08-16T00:00:00.000Z)");
    expect(markdown).toContain("YAML files processed: 0");
    expect(markdown).toContain("- ca: 0");
  });

  it("includes an unmatched organization's reason and representative summaries", () => {
    const report = reportFixture({
      totals: {
        yamlFiles: 1,
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
      },
    });
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("**Acme Corp** (`acme.yaml`, category A) — no roster subscriber at this domain");
    expect(markdown).toContain("Alice (CEO)");
  });

  it("includes dropped invalid links with their file and offending URL", () => {
    const report = reportFixture({
      generatedAt: "2026-08-17T00:00:00.000Z",
      totals: {
        yamlFiles: 1,
        matchedOrgs: 1,
      },
      invalidLinks: [{ file: "acme.yaml", name: "Acme Corp", url: "ttps://x.com/acme" }],
    });
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("Invalid links dropped");
    expect(markdown).toContain("**Acme Corp** (`acme.yaml`) — `ttps://x.com/acme`");
  });
});
