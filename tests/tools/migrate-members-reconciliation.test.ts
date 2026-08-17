import { describe, expect, it } from "vitest";
import {
  normalizeOrgName,
  emailDomain,
  sentinelEmailForSlug,
  matchRepsToCandidates,
  buildEmailsByDomain,
  candidateEmailsForDomains,
} from "../../scripts/migrate-members/reconciliation.mjs";

describe("normalizeOrgName", () => {
  it("lowercases and collapses internal whitespace", () => {
    expect(normalizeOrgName("  Acme   Corp  ")).toBe("acme corp");
  });
});

describe("emailDomain", () => {
  it("extracts the lowercased domain", () => {
    expect(emailDomain("Alice@Acme.Example")).toBe("acme.example");
  });

  it("returns an empty string for an email with no @", () => {
    expect(emailDomain("not-an-email")).toBe("");
  });
});

describe("sentinelEmailForSlug", () => {
  it("is deterministic for a given slug and uses the .invalid TLD", () => {
    expect(sentinelEmailForSlug("bob")).toBe("unmatched-bob@members.invalid");
    expect(sentinelEmailForSlug("bob")).toBe(sentinelEmailForSlug("bob"));
  });
});

describe("buildEmailsByDomain / candidateEmailsForDomains", () => {
  it("groups roster emails by domain and sorts by join order", () => {
    const roster = new Map([
      ["later@acme.example", { joinSortKey: "2023-02" }],
      ["earlier@acme.example", { joinSortKey: "2023-01" }],
      ["someone@other.example", { joinSortKey: "2023-01" }],
    ]);
    const byDomain = buildEmailsByDomain(roster);
    const candidates = candidateEmailsForDomains(["acme.example"], byDomain);
    expect(candidates.map((c) => c.email)).toEqual(["earlier@acme.example", "later@acme.example"]);
  });

  it("de-duplicates an email that matches more than one requested domain", () => {
    const roster = new Map([["shared@acme.example", { joinSortKey: "2023-01" }]]);
    const byDomain = buildEmailsByDomain(roster);
    const candidates = candidateEmailsForDomains(["acme.example", "acme.example"], byDomain);
    expect(candidates).toHaveLength(1);
  });
});

describe("matchRepsToCandidates", () => {
  it("pairs a representative to the candidate whose email local-part contains their name", () => {
    const reps = [{ name: "Alice Anderson" }, { name: "Bob Baker" }];
    const candidates = [{ email: "bob.baker@acme.example" }, { email: "alice.anderson@acme.example" }];
    const assignment = matchRepsToCandidates(reps, candidates);
    expect(candidates[assignment[0]].email).toBe("alice.anderson@acme.example");
    expect(candidates[assignment[1]].email).toBe("bob.baker@acme.example");
  });

  it("falls back to positional pairing for a representative with no name-matched candidate", () => {
    const reps = [{ name: "Nomatch Person" }];
    const candidates = [{ email: "random@acme.example" }];
    const assignment = matchRepsToCandidates(reps, candidates);
    expect(assignment).toEqual([0]);
  });

  it("leaves a representative unassigned once every candidate is claimed", () => {
    const reps = [{ name: "Alice Anderson" }, { name: "Extra Person" }];
    const candidates = [{ email: "alice.anderson@acme.example" }];
    const assignment = matchRepsToCandidates(reps, candidates);
    expect(assignment[0]).toBe(0);
    expect(assignment[1]).toBeNull();
  });
});
