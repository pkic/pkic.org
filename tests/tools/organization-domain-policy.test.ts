import { describe, expect, it } from "vitest";
import { resolveDomainOrganization, type DomainOwnershipFacts } from "../../assets/shared/organization-domain";

describe("organization domain resolution", () => {
  const shared: DomainOwnershipFacts = {
    claimed: [
      { organizationId: "first", isMember: true },
      { organizationId: "second", isMember: false },
    ],
    heldByApplication: false,
    derived: [],
  };

  it("requires a choice when several organizations claim the domain", () => {
    expect(resolveDomainOrganization(shared)).toEqual({ kind: "ambiguous" });
    expect(resolveDomainOrganization(shared, { organizationId: "first" })).toEqual({
      kind: "organization",
      organizationId: "first",
      isMember: true,
      via: "claim",
    });
    expect(resolveDomainOrganization(shared, { organizationId: "second" })).toEqual({
      kind: "organization",
      organizationId: "second",
      isMember: false,
      via: "claim",
    });
    expect(resolveDomainOrganization(shared, { organizationId: "unrelated" })).toEqual({ kind: "ambiguous" });
  });

  it("allows an explicit approved organization choice alongside an application", () => {
    expect(resolveDomainOrganization({ ...shared, heldByApplication: true }, { organizationId: "first" })).toEqual({
      kind: "organization",
      organizationId: "first",
      isMember: true,
      via: "claim",
    });
    expect(resolveDomainOrganization({ ...shared, heldByApplication: true })).toEqual({ kind: "ambiguous" });
  });
});
