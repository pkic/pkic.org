import { describe, expect, it } from "vitest";
import {
  findCategoryViolations,
  assertCategoriesValid,
  isIndividualMembershipCategory,
} from "../../scripts/migrate-members/categories.mjs";

function record(filename: string, doc: Record<string, unknown>) {
  return { filename, slug: filename.replace(/\.ya?ml$/, ""), doc };
}

describe("isIndividualMembershipCategory", () => {
  it("is the canonical shared classification, not a locally-redeclared set", () => {
    expect(isIndividualMembershipCategory("H5")).toBe(true);
    expect(isIndividualMembershipCategory("H6")).toBe(true);
    expect(isIndividualMembershipCategory("H7")).toBe(true);
    expect(isIndividualMembershipCategory("A")).toBe(false);
    expect(isIndividualMembershipCategory("H1")).toBe(false);
  });
});

describe("findCategoryViolations", () => {
  it("reports no violations for a clean dataset", () => {
    const result = findCategoryViolations([
      record("acme.yaml", { name: "Acme Corp", memberType: "A" }),
      record("bob.yaml", { name: "Bob", memberType: "H6" }),
    ]);
    expect(result).toEqual({ missing: [], unknown: [] });
  });

  it("reports a blank/missing memberType", () => {
    const result = findCategoryViolations([record("acme.yaml", { name: "Acme Corp" })]);
    expect(result.missing).toEqual([{ file: "acme.yaml", name: "Acme Corp" }]);
    expect(result.unknown).toEqual([]);
  });

  it("reports a memberType outside the canonical MEMBERSHIP_CATEGORIES vocabulary", () => {
    const result = findCategoryViolations([record("acme.yaml", { name: "Acme Corp", memberType: "Z9" })]);
    expect(result.unknown).toEqual([{ file: "acme.yaml", name: "Acme Corp", memberType: "Z9" }]);
    expect(result.missing).toEqual([]);
  });

  it("does not flag an individual category record that also sets organizationDomains (real, legitimate production pattern used for email-matching)", () => {
    const result = findCategoryViolations([
      record("uwe.yaml", { name: "Uwe Gradenegger", memberType: "H6", organizationDomains: ["gradenegger.eu"] }),
    ]);
    expect(result).toEqual({ missing: [], unknown: [] });
  });
});

describe("assertCategoriesValid", () => {
  it("does not throw for a clean dataset", () => {
    expect(() => assertCategoriesValid([record("acme.yaml", { name: "Acme Corp", memberType: "A" })])).not.toThrow();
  });

  it("throws a single error enumerating every missing/unknown category, before any SQL would be generated", () => {
    expect(() =>
      assertCategoriesValid([
        record("acme.yaml", { name: "Acme Corp" }), // missing
        record("bogus.yaml", { name: "Bogus Inc", memberType: "ZZ" }), // unknown
        record("ok.yaml", { name: "OK Inc", memberType: "B" }),
      ]),
    ).toThrowError(/Category preflight failed: 2 record\(s\) rejected\. No SQL was generated\./);
  });
});
